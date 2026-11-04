import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COVER_MAX_BYTES,
  RESTAURANT_DESCRIPTION_MAX_LENGTH,
  type Catalog,
  type Category,
  type CoverUploadResult,
  type Product,
  type PublicMenu,
  type Restaurant,
} from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function owner() {
  const email = `look${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `look-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

async function proOwner() {
  const result = await owner();
  await setPlan(result.restaurant.id, "pro");
  return result;
}

const setPlan = (restaurantId: string, plan: "basic" | "pro") =>
  env.DB.prepare("UPDATE restaurants SET plan = ? WHERE id = ?").bind(plan, restaurantId).run();

const patchAppearance = (client: Client, body: unknown) =>
  client.request("/api/restaurants/me/appearance", { method: "PATCH", body: JSON.stringify(body) });

const me = async (client: Client) => (await (await client.request("/api/restaurants/me")).json()) as Restaurant;
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

/** Bytes with a valid WebP container header (`RIFF....WEBP`), padded to `size`. */
function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  return bytes;
}

const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

function uploadCover(client: Client, bytes: Uint8Array, type = "image/webp") {
  const form = new FormData();
  form.append("file", new File([bytes], "cover.webp", { type }));
  return client.request("/api/restaurants/me/cover", { method: "PUT", body: form });
}

const keyOf = (coverUrl: string) => coverUrl.replace("/api/media/", "");

async function createCategory(client: Client, name: string) {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(client: Client, categoryId: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post("/api/products", {
    categoryId,
    name: "Hamburguesa completa",
    description: "",
    priceCents: 900_000,
    available: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Product;
}

const setFeatured = (client: Client, id: string, featured: boolean) =>
  client.request(`/api/categories/${id}/featured`, { method: "PUT", body: JSON.stringify({ featured }) });

const catalog = async (client: Client) => (await (await client.request("/api/categories")).json()) as Catalog;
const featuredIds = async (client: Client) =>
  (await catalog(client)).categories.filter((category) => category.featured).map((category) => category.id);

const getMenu = (slug: string) => new Client().request(`/api/public/menus/${slug}`);

describe("PATCH /api/restaurants/me/appearance: description (scenario 6)", () => {
  it("saves a normalized description on a Basic plan and returns the updated restaurant", async () => {
    const { client, restaurant } = await owner();
    expect(restaurant.plan).toBe("basic");
    expect(restaurant).toMatchObject({ description: "", coverUrl: null, bgColor: null, primaryColor: null });

    const res = await patchAppearance(client, { description: "  Pizza   y\n\nempanadas \t caseras  " });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Restaurant;
    expect(updated.id).toBe(restaurant.id);
    expect(updated.description).toBe("Pizza y empanadas caseras");
    expect((await me(client)).description).toBe("Pizza y empanadas caseras");
  });

  it("accepts an empty description and clears the saved one", async () => {
    const { client } = await owner();
    await patchAppearance(client, { description: "Algo" });
    const res = await patchAppearance(client, { description: "   " });
    expect(res.status).toBe(200);
    expect((await me(client)).description).toBe("");
  });

  it("accepts the maximum length and rejects one more, measured after normalizing (422)", async () => {
    const { client } = await owner();
    expect((await patchAppearance(client, { description: `  ${"a".repeat(RESTAURANT_DESCRIPTION_MAX_LENGTH)}  ` })).status).toBe(200);

    const res = await patchAppearance(client, { description: "a".repeat(RESTAURANT_DESCRIPTION_MAX_LENGTH + 1) });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
    expect((await me(client)).description).toBe("a".repeat(RESTAURANT_DESCRIPTION_MAX_LENGTH));
  });
});

describe("PATCH /api/restaurants/me/appearance: colors on Pro (scenario 7)", () => {
  it("saves the colors as uppercase #RRGGBB and keeps them after reloading", async () => {
    const { client } = await proOwner();
    const res = await patchAppearance(client, { bgColor: "#1c1917", primaryColor: "16a34a" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bgColor: "#1C1917", primaryColor: "#16A34A" });
    expect(await me(client)).toMatchObject({ bgColor: "#1C1917", primaryColor: "#16A34A" });
  });

  it("expands the short form", async () => {
    const { client } = await proOwner();
    const res = await patchAppearance(client, { bgColor: "#fff" });
    expect(((await res.json()) as Restaurant).bgColor).toBe("#FFFFFF");
  });

  it("sends only the keys that change and goes back to the default with null", async () => {
    const { client } = await proOwner();
    expect((await patchAppearance(client, { bgColor: "#1C1917", primaryColor: "#16A34A" })).status).toBe(200);

    const res = await patchAppearance(client, { primaryColor: null });
    expect(await res.json()).toMatchObject({ bgColor: "#1C1917", primaryColor: null });
    expect(await me(client)).toMatchObject({ bgColor: "#1C1917", primaryColor: null });
  });

  it.each(["nope", "#12", "#GGGGGG", "rgb(0,0,0)", ""])("answers 422 for the invalid color %j", async (bgColor) => {
    const { client } = await proOwner();
    const res = await patchAppearance(client, { bgColor });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/restaurants/me/appearance: Basic plan (scenario 8)", () => {
  it.each([
    ["bgColor", { bgColor: "#FEF3C7" }],
    ["primaryColor", { primaryColor: "#16A34A" }],
    ["a null color", { primaryColor: null }],
    ["colors together with a description", { description: "Nuevo", bgColor: "#FEF3C7" }],
  ])("answers 403 PLAN_FEATURE for %s and changes nothing", async (_label, body) => {
    const { client } = await owner();
    const before = await me(client);

    const res = await patchAppearance(client, body);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("PLAN_FEATURE");
    expect(await me(client)).toEqual(before);
  });

  it("still saves a description-only request, like Pro", async () => {
    const { client } = await owner();
    const res = await patchAppearance(client, { description: "Cocina casera" });
    expect(res.status).toBe(200);
    expect((await me(client)).description).toBe("Cocina casera");
  });

  it("refuses colors after a downgrade but keeps the saved ones", async () => {
    const { client, restaurant } = await proOwner();
    await patchAppearance(client, { bgColor: "#1C1917" });
    await setPlan(restaurant.id, "basic");

    expect((await patchAppearance(client, { bgColor: null })).status).toBe(403);
    expect((await me(client)).bgColor).toBe("#1C1917");
  });
});

describe("PATCH /api/restaurants/me/appearance: pair validation and access (scenario 9)", () => {
  it("accepts a primary too close to the background: the contrast check is advisory only", async () => {
    const { client } = await proOwner();
    const res = await patchAppearance(client, { bgColor: "#1C1917", primaryColor: "#1D4ED8" });
    expect(res.status).toBe(200);
    expect(await me(client)).toMatchObject({ bgColor: "#1C1917", primaryColor: "#1D4ED8" });

    // Saved primary + sent background: a light yellow on white is also saved.
    await patchAppearance(client, { bgColor: "#1C1917", primaryColor: "#FEF3C7" });
    expect((await patchAppearance(client, { bgColor: "#FFFFFF" })).status).toBe(200);
    expect(await me(client)).toMatchObject({ bgColor: "#FFFFFF", primaryColor: "#FEF3C7" });
  });

  it("still rejects a color that is not hexadecimal (422)", async () => {
    const { client } = await proOwner();
    expect((await patchAppearance(client, { bgColor: "rgb(0,0,0)" })).status).toBe(422);
    expect((await patchAppearance(client, { primaryColor: "#12" })).status).toBe(422);
    expect(await me(client)).toMatchObject({ bgColor: null, primaryColor: null });
  });

  it("accepts a medium primary on a light background (3:1 is enough)", async () => {
    const { client } = await proOwner();
    expect((await patchAppearance(client, { bgColor: "#F7F5F2", primaryColor: "#16A34A" })).status).toBe(200);
  });

  it("answers 401 without a session", async () => {
    const res = await patchAppearance(new Client(), { description: "x" });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("UNAUTHORIZED");
  });

  it("answers 404 RESTAURANT_NOT_FOUND when the user has no restaurant", async () => {
    const email = `nolocal${unique()}@example.com`;
    await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
    const client = new Client();
    await client.open(sink.last().link);
    const res = await patchAppearance(client, { description: "x" });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("RESTAURANT_NOT_FOUND");
  });

  it.each([{}, { unknown: true }, []])("answers 422 for the body %j", async (body) => {
    const { client } = await owner();
    const res = await patchAppearance(client, body);
    expect(res.status).toBe(422);
  });

  it("answers 422 for a body that is not JSON", async () => {
    const { client } = await owner();
    const res = await client.request("/api/restaurants/me/appearance", { method: "PATCH", body: "not json" });
    expect(res.status).toBe(422);
  });
});

describe("cover upload (scenario 10)", () => {
  it("answers 401 without a session", async () => {
    const put = await uploadCover(new Client(), webpBytes());
    expect(put.status).toBe(401);
    const del = await new Client().request("/api/restaurants/me/cover", { method: "DELETE" });
    expect(del.status).toBe(401);
  });

  it("stores the cover in R2 under covers/<restaurantId>/ on a Basic plan and exposes it in /me", async () => {
    const { client, restaurant } = await owner();
    expect(restaurant.plan).toBe("basic");

    const res = await uploadCover(client, webpBytes());
    expect(res.status).toBe(200);
    const { coverUrl } = (await res.json()) as CoverUploadResult;
    expect(coverUrl).toMatch(new RegExp(`^/api/media/covers/${restaurant.id}/[0-9a-f-]{36}\\.webp$`));

    expect((await me(client)).coverUrl).toBe(coverUrl);
    expect((await env.MEDIA.get(keyOf(coverUrl)))?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("replaces the cover and deletes the previous object from R2", async () => {
    const { client } = await owner();
    const first = ((await (await uploadCover(client, webpBytes())).json()) as CoverUploadResult).coverUrl;
    const second = ((await (await uploadCover(client, webpBytes(80))).json()) as CoverUploadResult).coverUrl;

    expect(second).not.toBe(first);
    expect((await me(client)).coverUrl).toBe(second);
    expect(await env.MEDIA.head(keyOf(first))).toBeNull();
    expect(await env.MEDIA.head(keyOf(second))).not.toBeNull();
  });

  it("deletes the cover (204), clearing the column and the object, and also when there is none", async () => {
    const { client } = await owner();
    expect((await client.request("/api/restaurants/me/cover", { method: "DELETE" })).status).toBe(204);

    const { coverUrl } = (await (await uploadCover(client, webpBytes())).json()) as CoverUploadResult;
    const res = await client.request("/api/restaurants/me/cover", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await me(client)).coverUrl).toBeNull();
    expect(await env.MEDIA.head(keyOf(coverUrl))).toBeNull();
  });

  it("keeps the logo and the cover apart", async () => {
    const { client } = await owner();
    const form = new FormData();
    form.append("file", new File([webpBytes()], "logo.webp", { type: "image/webp" }));
    const logo = (await (await client.request("/api/restaurants/me/logo", { method: "PUT", body: form })).json()) as {
      logoUrl: string;
    };
    const { coverUrl } = (await (await uploadCover(client, webpBytes())).json()) as CoverUploadResult;

    expect(await me(client)).toMatchObject({ logoUrl: logo.logoUrl, coverUrl });
    await client.request("/api/restaurants/me/cover", { method: "DELETE" });
    expect(await me(client)).toMatchObject({ logoUrl: logo.logoUrl, coverUrl: null });
  });

  it.each([
    ["a Content-Type other than image/webp", webpBytes(), "image/png"],
    ["bytes that are not WebP (bad magic bytes)", pngBytes(), "image/webp"],
    ["an empty file", new Uint8Array(), "image/webp"],
  ])("answers 415 for %s", async (_label, bytes, type) => {
    const { client } = await owner();
    const res = await uploadCover(client, bytes, type);
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect((await me(client)).coverUrl).toBeNull();
  });

  it("answers 415 when the body is not multipart", async () => {
    const { client } = await owner();
    const res = await client.request("/api/restaurants/me/cover", {
      method: "PUT",
      body: new Blob([webpBytes()], { type: "image/webp" }),
      headers: { "Content-Type": "image/webp" },
    });
    expect(res.status).toBe(415);
  });

  it("answers 413 for a file over 1 MB and accepts exactly 1 MB", async () => {
    const { client } = await owner();
    const big = await uploadCover(client, webpBytes(COVER_MAX_BYTES + 1));
    expect(big.status).toBe(413);
    expect((await errorOf(big)).code).toBe("FILE_TOO_LARGE");
    expect((await me(client)).coverUrl).toBeNull();

    expect((await uploadCover(client, webpBytes(3 * COVER_MAX_BYTES))).status).toBe(413);
    expect((await uploadCover(client, webpBytes(COVER_MAX_BYTES))).status).toBe(200);
  });

  it("answers 422 when the file field is missing", async () => {
    const { client } = await owner();
    const form = new FormData();
    form.append("other", "x");
    expect((await client.request("/api/restaurants/me/cover", { method: "PUT", body: form })).status).toBe(422);
  });

  it("serves the cover publicly as image/webp with immutable cache and nosniff", async () => {
    const { client } = await owner();
    const bytes = webpBytes(100);
    const { coverUrl } = (await (await uploadCover(client, bytes)).json()) as CoverUploadResult;

    const res = await new Client().request(coverUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    "/api/media/covers/missing/00000000-0000-0000-0000-000000000000.webp",
    "/api/media/covers/x/../secret.webp",
    "/api/media/avatars/x/00000000-0000-0000-0000-000000000000.webp",
    "/api/media/covers/00000000-0000-0000-0000-000000000000.webp",
  ])("answers 404 for %s", async (path) => {
    const res = await new Client().request(path);
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/categories/:id/featured (scenario 11)", () => {
  it("features a category and moves the mark from the previous one in one operation", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    const b = await createCategory(client, "Bebidas");

    expect((await setFeatured(client, a.id, true)).status).toBe(204);
    expect(await featuredIds(client)).toEqual([a.id]);

    expect((await setFeatured(client, b.id, true)).status).toBe(204);
    expect(await featuredIds(client)).toEqual([b.id]);
  });

  it("is idempotent when the category is already featured", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    await setFeatured(client, a.id, true);
    expect((await setFeatured(client, a.id, true)).status).toBe(204);
    expect(await featuredIds(client)).toEqual([a.id]);
  });

  it("unmarks only when the category was the featured one", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    const b = await createCategory(client, "Bebidas");
    await setFeatured(client, a.id, true);

    expect((await setFeatured(client, b.id, false)).status).toBe(204);
    expect(await featuredIds(client)).toEqual([a.id]);

    expect((await setFeatured(client, a.id, false)).status).toBe(204);
    expect(await featuredIds(client)).toEqual([]);
  });

  it("answers 404 CATEGORY_NOT_FOUND for an unknown or foreign id and changes nothing", async () => {
    const mine = await owner();
    const other = await owner();
    const own = await createCategory(mine.client, "Promos");
    const foreign = await createCategory(other.client, "Ajena");
    await setFeatured(mine.client, own.id, true);

    for (const id of [foreign.id, "does-not-exist"]) {
      for (const featured of [true, false]) {
        const res = await setFeatured(mine.client, id, featured);
        expect(res.status).toBe(404);
        expect((await errorOf(res)).code).toBe("CATEGORY_NOT_FOUND");
      }
    }
    expect(await featuredIds(mine.client)).toEqual([own.id]);
    expect(await featuredIds(other.client)).toEqual([]);
  });

  it("answers 422 for an invalid body and 401 without a session", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    const bad = await client.request(`/api/categories/${a.id}/featured`, { method: "PUT", body: JSON.stringify({ featured: "yes" }) });
    expect(bad.status).toBe(422);

    const res = await setFeatured(new Client(), a.id, true);
    expect(res.status).toBe(401);
  });

  it("is backed by a partial unique index: the database refuses a second featured category", async () => {
    const { client, restaurant } = await owner();
    const a = await createCategory(client, "Promos");
    const b = await createCategory(client, "Bebidas");
    const mark = (id: string) =>
      env.DB.prepare("UPDATE categories SET is_featured = 1 WHERE id = ? AND restaurant_id = ?").bind(id, restaurant.id).run();

    await mark(a.id);
    await expect(mark(b.id)).rejects.toThrow(/UNIQUE|constraint/i);
    expect(await featuredIds(client)).toEqual([a.id]);
  });

  it("allows one featured category per restaurant", async () => {
    const one = await owner();
    const two = await owner();
    const a = await createCategory(one.client, "Promos");
    const b = await createCategory(two.client, "Promos");
    await setFeatured(one.client, a.id, true);
    await setFeatured(two.client, b.id, true);
    expect(await featuredIds(one.client)).toEqual([a.id]);
    expect(await featuredIds(two.client)).toEqual([b.id]);
  });
});

describe("GET /api/categories featured flag (scenario 12)", () => {
  it("lists featured on every category and keeps it when renaming and reordering", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    const b = await createCategory(client, "Bebidas");
    await setFeatured(client, b.id, true);

    expect((await catalog(client)).categories.map((c) => [c.name, c.featured])).toEqual([
      ["Promos", false],
      ["Bebidas", true],
    ]);

    const renamed = await client.request(`/api/categories/${b.id}`, { method: "PATCH", body: JSON.stringify({ name: "Tragos" }) });
    expect(((await renamed.json()) as Category).featured).toBe(true);
    await client.request("/api/categories/order", { method: "PUT", body: JSON.stringify({ ids: [b.id, a.id] }) });

    expect((await catalog(client)).categories.map((c) => [c.name, c.featured])).toEqual([
      ["Tragos", true],
      ["Promos", false],
    ]);
  });

  it("returns featured: false for a category just created", async () => {
    const { client } = await owner();
    expect((await createCategory(client, "Promos")).featured).toBe(false);
  });

  it("deletes an empty featured category and leaves the restaurant without one", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "Promos");
    await setFeatured(client, a.id, true);

    expect((await client.request(`/api/categories/${a.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await featuredIds(client)).toEqual([]);
    const b = await createCategory(client, "Bebidas");
    expect((await setFeatured(client, b.id, true)).status).toBe(204);
  });
});

describe("GET /api/public/menus/:slug appearance (scenario 13)", () => {
  it("publishes the cover, the description and the default colors for a fresh restaurant", async () => {
    const { restaurant } = await owner();
    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.restaurant).toMatchObject({
      coverUrl: null,
      description: "",
      colors: { background: "#F7F5F2", primary: "#C2410C" },
    });
  });

  it("publishes the saved colors of a Pro restaurant, and the defaults where nothing was saved", async () => {
    const { client, restaurant } = await proOwner();
    await patchAppearance(client, { bgColor: "#1c1917" });
    const { coverUrl } = (await (await uploadCover(client, webpBytes())).json()) as CoverUploadResult;
    await patchAppearance(client, { description: "Cocina casera" });

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.restaurant).toMatchObject({
      coverUrl,
      description: "Cocina casera",
      colors: { background: "#1C1917", primary: "#C2410C" },
    });

    await patchAppearance(client, { primaryColor: "#16a34a" });
    const both = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(both.restaurant.colors).toEqual({ background: "#1C1917", primary: "#16A34A" });
  });

  it("publishes only the defaults on Basic, even with colors saved before a downgrade, and brings them back on Pro", async () => {
    const { client, restaurant } = await proOwner();
    expect((await patchAppearance(client, { bgColor: "#1C1917", primaryColor: "#16A34A" })).status).toBe(200);
    await setPlan(restaurant.id, "basic");

    const basic = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(basic.restaurant.colors).toEqual({ background: "#F7F5F2", primary: "#C2410C" });
    expect(JSON.stringify(basic)).not.toMatch(/1C1917|16A34A/);
    // The cover and the description are not plan features.
    expect(basic.restaurant.description).toBe("");

    await setPlan(restaurant.id, "pro");
    const pro = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(pro.restaurant.colors).toEqual({ background: "#1C1917", primary: "#16A34A" });
  });

  it("still leaves out the owner, plan, status, WhatsApp, timestamps and non-product ids", async () => {
    const { client, restaurant } = await proOwner();
    const category = await createCategory(client, "Promos");
    await createProduct(client, category.id);
    await setFeatured(client, category.id, true);
    await patchAppearance(client, { description: "Cocina casera", bgColor: "#1C1917" });
    await env.DB.prepare("UPDATE restaurant_appearance SET cover_url = ? WHERE restaurant_id = ?")
      .bind("/api/media/covers/x.webp", restaurant.id)
      .run();

    const text = await (await getMenu(restaurant.slug)).text();
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(JSON.parse(text));

    // An exact key list is the whitelist: no owner, plan, status, WhatsApp, timestamps or flags.
    expect([...keys].sort()).toEqual(
      [
        "acceptingOrders",
        "alias",
        "available",
        "background",
        "categories",
        "colors",
        "coverUrl",
        "delivery",
        "deliveryMode",
        "description",
        "featured",
        "holderName",
        "id",
        "imageUrl",
        "ingredients",
        "location",
        "logoUrl",
        "method",
        "minOrderCents",
        "name",
        "paymentMethods",
        "priceCents",
        "primary",
        "products",
        "restaurant",
        "shippingCents",
        "slug",
        "takeaway",
      ].sort(),
    );
    for (const secret of [restaurant.id, category.id, restaurant.whatsapp, "5491112345678", "bgColor", "primaryColor"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("GET /api/public/menus/:slug featured category (scenario 14)", () => {
  it("returns the featured category apart and leaves it out of categories", async () => {
    const { client, restaurant } = await owner();
    const promos = await createCategory(client, "Promos");
    const drinks = await createCategory(client, "Bebidas");
    const promo = await createProduct(client, promos.id, { name: "2 hamburguesas + papas", description: "Combo" });
    const coke = await createProduct(client, drinks.id, { name: "Coca" });
    await setFeatured(client, promos.id, true);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured).toEqual({
      name: "Promos",
      products: [
        {
          id: promo.id,
          name: "2 hamburguesas + papas",
          description: "Combo",
          priceCents: 900_000,
          imageUrl: null,
          available: true,
          ingredients: [],
        },
      ],
    });
    expect(menu.categories.map((category) => category.name)).toEqual(["Bebidas"]);
    expect(menu.categories[0]?.products[0]?.id).toBe(coke.id);
    // The product id is the cart key, so it must not appear in two places.
    expect(JSON.stringify(menu.categories)).not.toContain(promo.id);
  });

  it("returns featured: null when the featured category has no products, and does not list it", async () => {
    const { client, restaurant } = await owner();
    const promos = await createCategory(client, "Promos");
    const drinks = await createCategory(client, "Bebidas");
    await createProduct(client, drinks.id);
    await setFeatured(client, promos.id, true);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured).toBeNull();
    expect(menu.categories.map((category) => category.name)).toEqual(["Bebidas"]);
  });

  it("returns a featured category whose products are all sold out", async () => {
    const { client, restaurant } = await owner();
    const promos = await createCategory(client, "Promos");
    await createProduct(client, promos.id, { name: "Combo", available: false });
    await setFeatured(client, promos.id, true);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured?.name).toBe("Promos");
    expect(menu.featured?.products.map((product) => product.available)).toEqual([false]);
    expect(menu.categories).toEqual([]);
  });

  it("is null without a featured category and keeps skipping empty normal categories", async () => {
    const { client, restaurant } = await owner();
    await createCategory(client, "Vacía");
    const full = await createCategory(client, "Llena");
    await createProduct(client, full.id);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured).toBeNull();
    expect(menu.categories.map((category) => category.name)).toEqual(["Llena"]);
  });

  it("is not a plan feature: Basic publishes the featured row", async () => {
    const { client, restaurant } = await owner();
    expect(restaurant.plan).toBe("basic");
    const promos = await createCategory(client, "Promos");
    await createProduct(client, promos.id);
    await setFeatured(client, promos.id, true);

    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured?.name).toBe("Promos");
  });

  it("follows the featured mark when it moves to another category", async () => {
    const { client, restaurant } = await owner();
    const a = await createCategory(client, "Promos");
    const b = await createCategory(client, "Bebidas");
    await createProduct(client, a.id);
    await createProduct(client, b.id);

    await setFeatured(client, a.id, true);
    await setFeatured(client, b.id, true);
    const menu = (await (await getMenu(restaurant.slug)).json()) as PublicMenu;
    expect(menu.featured?.name).toBe("Bebidas");
    expect(menu.categories.map((category) => category.name)).toEqual(["Promos"]);
  });
});
