import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_LIMITS,
  PRICE_MAX_CENTS,
  PRODUCT_PHOTO_MAX_BYTES,
  type Catalog,
  type Category,
  type Ingredient,
  type Product,
  type ProductPhotoUploadResult,
  type Restaurant,
} from "@menucito/shared";
import { Client, captureEmails } from "./helpers";
import { createCategoriesRepository } from "../src/repositories/categories";
import { UniqueViolationError, asUniqueViolation } from "../src/repositories/errors";
import { createIngredientsRepository } from "../src/repositories/ingredients";
import { createProductsRepository, type ProductsRepository } from "../src/repositories/products";
import { createRestaurantsRepository } from "../src/repositories/restaurants";
import { PlanFeatureError, PlanLimitError, createCatalogService } from "../src/services/catalog";
import { createMediaStorage, type MediaStorage } from "../src/storage/media";
import type { Env } from "../src/env";
import type { ProductRow, RestaurantRow } from "../src/db/schema";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** Signs up, verifies (which opens a session) and returns the logged-in client. */
async function loggedInClient(bindings: Partial<Env> = {}) {
  const email = `menu${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client(bindings);
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  return client;
}

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function owner(bindings: Partial<Env> = {}) {
  const client = await loggedInClient(bindings);
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `menu-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

async function createCategory(client: Client, name: string) {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(client: Client, categoryId: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post("/api/products", {
    categoryId,
    name: "Hamburguesa completa",
    description: "Carne, queso y huevo",
    priceCents: 900_000,
    available: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Product;
}

async function catalog(client: Client) {
  const res = await client.request("/api/categories");
  expect(res.status).toBe(200);
  return (await res.json()) as Catalog;
}

const categoryNames = async (client: Client) => (await catalog(client)).categories.map((c) => c.name);
const productNames = async (client: Client, categoryId: string) =>
  (await catalog(client)).categories.find((c) => c.id === categoryId)?.products.map((p) => p.name);

/** Bytes with a valid WebP container header (`RIFF....WEBP`), padded to `size`. */
function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  return bytes;
}

function uploadPhoto(client: Client, productId: string, bytes: Uint8Array = webpBytes(), type = "image/webp") {
  const form = new FormData();
  form.append("file", new File([bytes], "photo.webp", { type }));
  return client.request(`/api/products/${productId}/photo`, { method: "PUT", body: form });
}

async function photoOf(client: Client, productId: string) {
  const res = await uploadPhoto(client, productId);
  expect(res.status).toBe(200);
  return ((await res.json()) as ProductPhotoUploadResult).imageUrl;
}

const getProduct = async (client: Client, id: string) =>
  (await (await client.request(`/api/products/${id}`)).json()) as Product;
const keyOf = (url: string) => url.replace("/api/media/", "");

/** Inserts `count` products straight into D1 (faster than one request each). */
async function seedProducts(restaurantId: string, categoryId: string, count: number) {
  const insert = env.DB.prepare(
    "INSERT INTO products (id, restaurant_id, category_id, name, price_cents, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  await env.DB.batch(
    Array.from({ length: count }, (_, i) =>
      insert.bind(crypto.randomUUID(), restaurantId, categoryId, `Seed ${i}`, 100, i, now, now),
    ),
  );
}

describe("authentication and tenant (scenario 21)", () => {
  const endpoints: [string, string][] = [
    ["GET", "/api/categories"],
    ["POST", "/api/categories"],
    ["PATCH", "/api/categories/x"],
    ["DELETE", "/api/categories/x"],
    ["PUT", "/api/categories/order"],
    ["PUT", "/api/categories/x/products/order"],
    ["POST", "/api/products"],
    ["GET", "/api/products/x"],
    ["PATCH", "/api/products/x"],
    ["DELETE", "/api/products/x"],
    ["PUT", "/api/products/x/photo"],
    ["DELETE", "/api/products/x/photo"],
    ["PUT", "/api/products/x/ingredients"],
  ];

  it.each(endpoints)("%s %s answers 401 without a session", async (method, path) => {
    const res = await new Client().request(path, { method, body: method === "GET" ? undefined : "{}" });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("answers 404 RESTAURANT_NOT_FOUND for a session without a restaurant", async () => {
    const client = await loggedInClient();
    for (const res of [
      await client.request("/api/categories"),
      await client.post("/api/categories", { name: "Pizzas" }),
      await client.request("/api/categories/order", json("PUT", { ids: ["x"] })),
      await client.post("/api/products", { categoryId: "x", name: "P", priceCents: 1 }),
      await client.request("/api/products/x"),
      await client.request("/api/products/x/photo", { method: "DELETE" }),
      await client.request("/api/products/x/ingredients", json("PUT", { ingredients: [] })),
    ]) {
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
    }
  });
});

describe("GET /api/categories (scenario 1)", () => {
  it("returns an empty catalog with the Basic plan usage", async () => {
    const { client } = await owner();
    expect(await catalog(client)).toEqual({
      categories: [],
      usage: { products: 0, maxProducts: PLAN_LIMITS.basic.maxProducts, productPhotos: PLAN_LIMITS.basic.productPhotos },
    });
  });
});

describe("categories", () => {
  it("creates categories at the end of the list (scenario 2)", async () => {
    const { client } = await owner();
    const first = await createCategory(client, "  Hamburguesas ");
    const second = await createCategory(client, "Milanesas");
    expect(first).toMatchObject({ name: "Hamburguesas", position: 0 });
    expect(second.position).toBe(1);
    expect(await categoryNames(client)).toEqual(["Hamburguesas", "Milanesas"]);
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 40 characters", { name: "a".repeat(41) }],
    ["a missing name", {}],
  ])("answers 422 for %s (scenario 2)", async (_label, body) => {
    const { client } = await owner();
    const res = await client.post("/api/categories", body);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
  });

  it("answers 409 CATEGORY_NAME_TAKEN for the same name in another casing (scenario 3)", async () => {
    const { client } = await owner();
    await createCategory(client, "Hamburguesas");
    const res = await client.post("/api/categories", { name: "  hamburguesas " });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CATEGORY_NAME_TAKEN");
    expect(await categoryNames(client)).toEqual(["Hamburguesas"]);
  });

  it("lets two restaurants use the same category name", async () => {
    const a = await owner();
    const b = await owner();
    await createCategory(a.client, "Bebidas");
    await createCategory(b.client, "Bebidas");
  });

  it("renames a category and keeps it after reloading (scenario 4)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const res = await client.request(`/api/categories/${category.id}`, json("PATCH", { name: "Burgers" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Category).name).toBe("Burgers");
    expect(await categoryNames(client)).toEqual(["Burgers"]);
  });

  it("answers 409 when renaming to another category's name, and allows a casing change of its own", async () => {
    const { client } = await owner();
    const burgers = await createCategory(client, "Hamburguesas");
    await createCategory(client, "Postres");
    const taken = await client.request(`/api/categories/${burgers.id}`, json("PATCH", { name: "POSTRES" }));
    expect(taken.status).toBe(409);
    expect(await errorCode(taken)).toBe("CATEGORY_NAME_TAKEN");
    const own = await client.request(`/api/categories/${burgers.id}`, json("PATCH", { name: "hamburguesas" }));
    expect(own.status).toBe(200);
  });

  it("reorders categories and keeps the order after reloading (scenario 4)", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "A");
    const b = await createCategory(client, "B");
    const c = await createCategory(client, "C");
    const res = await client.request("/api/categories/order", json("PUT", { ids: [c.id, a.id, b.id] }));
    expect(res.status).toBe(204);
    const { categories } = await catalog(client);
    expect(categories.map((x) => [x.name, x.position])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
  });

  it("deletes an empty category (scenario 5)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Postres");
    const res = await client.request(`/api/categories/${category.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await categoryNames(client)).toEqual([]);
  });

  it("answers 409 CATEGORY_NOT_EMPTY and deletes nothing when the category has products (scenario 5)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Postres");
    await createProduct(client, category.id, { name: "Flan" });
    const res = await client.request(`/api/categories/${category.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CATEGORY_NOT_EMPTY");
    expect(await productNames(client, category.id)).toEqual(["Flan"]);
  });
});

describe("products", () => {
  it("creates a product at the end of its category (scenario 6)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const first = await createProduct(client, category.id, { name: "Veggie" });
    const product = await createProduct(client, category.id);
    expect(first.position).toBe(0);
    expect(product).toMatchObject({
      categoryId: category.id,
      name: "Hamburguesa completa",
      description: "Carne, queso y huevo",
      priceCents: 900_000,
      available: true,
      imageUrl: null,
      position: 1,
    });
    const { categories, usage } = await catalog(client);
    expect(categories[0]?.products.map((p) => p.name)).toEqual(["Veggie", "Hamburguesa completa"]);
    expect(usage.products).toBe(2);
  });

  it.each([
    ["a decimal", 1.5],
    ["a negative value", -1],
    ["a value over the maximum", PRICE_MAX_CENTS + 1],
    ["a string", "900000"],
  ])("answers 422 for priceCents as %s (scenario 7)", async (_label, priceCents) => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const res = await client.post("/api/products", { categoryId: category.id, name: "X", priceCents });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    const patch = await client.request(`/api/products/${(await createProduct(client, category.id)).id}`, json("PATCH", { priceCents }));
    expect(patch.status).toBe(422);
  });

  it("accepts the maximum price", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    expect((await createProduct(client, category.id, { priceCents: PRICE_MAX_CENTS })).priceCents).toBe(PRICE_MAX_CENTS);
  });

  it("edits name, description, price and availability (scenarios 8, 9)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const res = await client.request(
      `/api/products/${product.id}`,
      json("PATCH", { name: "Completa", description: "", priceCents: 950_050 }),
    );
    expect(res.status).toBe(200);
    const toggled = await client.request(`/api/products/${product.id}`, json("PATCH", { available: false }));
    expect(toggled.status).toBe(200);
    expect(await getProduct(client, product.id)).toMatchObject({
      name: "Completa",
      description: "",
      priceCents: 950_050,
      available: false,
      position: 0,
    });
  });

  it("moves a product to the end of another category (scenario 10)", async () => {
    const { client } = await owner();
    const burgers = await createCategory(client, "Hamburguesas");
    const drinks = await createCategory(client, "Bebidas");
    const product = await createProduct(client, burgers.id);
    await createProduct(client, drinks.id, { name: "Agua" });
    await createProduct(client, drinks.id, { name: "Gaseosa" });

    const res = await client.request(`/api/products/${product.id}`, json("PATCH", { categoryId: drinks.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Product).position).toBe(2);
    expect(await productNames(client, drinks.id)).toEqual(["Agua", "Gaseosa", "Hamburguesa completa"]);
    expect(await productNames(client, burgers.id)).toEqual([]);
  });

  it("reorders the products of a category and keeps the order (scenario 11)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const a = await createProduct(client, category.id, { name: "A" });
    const b = await createProduct(client, category.id, { name: "B" });
    const c = await createProduct(client, category.id, { name: "C" });
    const res = await client.request(
      `/api/categories/${category.id}/products/order`,
      json("PUT", { ids: [b.id, c.id, a.id] }),
    );
    expect(res.status).toBe(204);
    expect(await productNames(client, category.id)).toEqual(["B", "C", "A"]);
  });

  it("deletes a product and its photo (scenario 12)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const imageUrl = await photoOf(client, product.id);

    const res = await client.request(`/api/products/${product.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await client.request(`/api/products/${product.id}`)).status).toBe(404);
    expect(await env.MEDIA.head(keyOf(imageUrl))).toBeNull();
    expect((await catalog(client)).usage.products).toBe(0);
  });

  it("answers 404 CATEGORY_NOT_FOUND when creating in an unknown category", async () => {
    const { client } = await owner();
    const res = await client.post("/api/products", { categoryId: "missing", name: "X", priceCents: 1 });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("CATEGORY_NOT_FOUND");
  });
});

describe("reorder validation (scenario 19)", () => {
  it.each([
    ["a missing id", (ids: string[]) => ids.slice(0, 2)],
    ["a duplicated id", (ids: string[]) => [ids[0], ids[0], ids[1], ids[2]]],
    ["an unknown id", (ids: string[]) => [...ids.slice(0, 2), "unknown"]],
    ["an empty list", () => []],
  ])("answers 422 for %s and changes nothing", async (_label, mutate) => {
    const { client } = await owner();
    const categories = [await createCategory(client, "A"), await createCategory(client, "B"), await createCategory(client, "C")];
    const ids = categories.map((c) => c.id).reverse();
    const res = await client.request("/api/categories/order", json("PUT", { ids: mutate(ids) }));
    expect(res.status).toBe(422);

    const category = categories[0] as Category;
    const products = [
      await createProduct(client, category.id, { name: "X" }),
      await createProduct(client, category.id, { name: "Y" }),
      await createProduct(client, category.id, { name: "Z" }),
    ];
    const productRes = await client.request(
      `/api/categories/${category.id}/products/order`,
      json("PUT", { ids: mutate(products.map((p) => p.id).reverse()) }),
    );
    expect(productRes.status).toBe(422);

    expect(await categoryNames(client)).toEqual(["A", "B", "C"]);
    expect(await productNames(client, category.id)).toEqual(["X", "Y", "Z"]);
  });

  it("answers 422 when a product id belongs to another category", async () => {
    const { client } = await owner();
    const a = await createCategory(client, "A");
    const b = await createCategory(client, "B");
    const x = await createProduct(client, a.id, { name: "X" });
    const y = await createProduct(client, b.id, { name: "Y" });
    const res = await client.request(`/api/categories/${a.id}/products/order`, json("PUT", { ids: [y.id] }));
    expect(res.status).toBe(422);
    expect(await productNames(client, a.id)).toEqual([x.name]);
  });
});

describe("product photos", () => {
  it("uploads a photo under products/<restaurantId>/ and exposes it on the product (scenario 13)", async () => {
    const { client, restaurant } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const imageUrl = await photoOf(client, product.id);
    expect(imageUrl).toMatch(new RegExp(`^/api/media/products/${restaurant.id}/[0-9a-f-]{36}\\.webp$`));
    expect((await getProduct(client, product.id)).imageUrl).toBe(imageUrl);
    expect((await env.MEDIA.get(keyOf(imageUrl)))?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("replaces the photo and deletes the old object; removing clears it (scenario 14)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const first = await photoOf(client, product.id);
    const second = await photoOf(client, product.id);
    expect(second).not.toBe(first);
    expect(await env.MEDIA.head(keyOf(first))).toBeNull();
    expect((await getProduct(client, product.id)).imageUrl).toBe(second);

    const res = await client.request(`/api/products/${product.id}/photo`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await env.MEDIA.head(keyOf(second))).toBeNull();
    expect((await getProduct(client, product.id)).imageUrl).toBeNull();

    const again = await client.request(`/api/products/${product.id}/photo`, { method: "DELETE" });
    expect(again.status).toBe(204);
  });

  it.each([
    ["a Content-Type other than image/webp", webpBytes(), "image/png", 415],
    ["bytes that are not WebP", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), "image/webp", 415],
    ["an SVG", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml", 415],
    ["a file over 1 MB", webpBytes(PRODUCT_PHOTO_MAX_BYTES + 1), "image/webp", 413],
    ["a much larger body", webpBytes(3 * PRODUCT_PHOTO_MAX_BYTES), "image/webp", 413],
  ])("answers the right status for %s (scenario 15)", async (_label, bytes, type, status) => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const res = await uploadPhoto(client, product.id, bytes, type);
    expect(res.status).toBe(status);
    expect(await errorCode(res)).toBe(status === 413 ? "FILE_TOO_LARGE" : "UNSUPPORTED_MEDIA_TYPE");
    expect((await getProduct(client, product.id)).imageUrl).toBeNull();
  });

  it("serves a product photo like a logo, and 404s outside logos/ and products/ (scenario 20)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const bytes = webpBytes(120);
    const res = await uploadPhoto(client, product.id, bytes);
    const { imageUrl } = (await res.json()) as ProductPhotoUploadResult;

    const served = await new Client().request(imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/webp");
    expect(served.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);

    await env.MEDIA.put("private/x/y.webp", webpBytes());
    for (const path of [
      "/api/media/products/missing/00000000-0000-0000-0000-000000000000.webp",
      "/api/media/private/x/y.webp",
      "/api/media/products/x/../y.webp",
      "/api/media/products/x.webp",
    ]) {
      expect((await new Client().request(path)).status).toBe(404);
    }
  });
});

describe("plan limits", () => {
  it("blocks creating products at the Basic limit but still allows edit, move and delete (scenario 16)", async () => {
    const limit = PLAN_LIMITS.basic.maxProducts as number;
    const { client, restaurant } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const other = await createCategory(client, "Bebidas");
    await seedProducts(restaurant.id, category.id, limit - 1);
    const last = await createProduct(client, category.id);

    const res = await client.post("/api/products", { categoryId: category.id, name: "Una más", priceCents: 100 });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_LIMIT");
    expect((await catalog(client)).usage).toEqual({ products: limit, maxProducts: limit, productPhotos: true });

    expect((await client.request(`/api/products/${last.id}`, json("PATCH", { name: "Editada" }))).status).toBe(200);
    expect((await client.request(`/api/products/${last.id}`, json("PATCH", { categoryId: other.id }))).status).toBe(200);
    expect((await client.request(`/api/products/${last.id}`, { method: "DELETE" })).status).toBe(204);
    await createProduct(client, category.id, { name: "Ahora sí" });
  });

  it("blocks product photos when the plan does not include them, but allows removing (scenario 17)", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const imageUrl = await photoOf(client, product.id);
    const userId = (await client.session())?.user as unknown as { id: string };

    const service = createCatalogService({
      restaurants: createRestaurantsRepository(env.DB),
      categories: createCategoriesRepository(env.DB),
      products: createProductsRepository(env.DB),
      ingredients: createIngredientsRepository(env.DB),
      storage: createMediaStorage(env.MEDIA),
      limitsFor: () => ({ maxProducts: null, productPhotos: false, customIngredients: false }),
    });
    const upload = { bytes: webpBytes().buffer as ArrayBuffer, contentType: "image/webp" };
    await expect(service.uploadProductPhoto(userId.id, product.id, upload)).rejects.toBeInstanceOf(PlanLimitError);
    expect((await getProduct(client, product.id)).imageUrl).toBe(imageUrl);

    await service.removeProductPhoto(userId.id, product.id);
    expect((await getProduct(client, product.id)).imageUrl).toBeNull();
    expect(await env.MEDIA.head(keyOf(imageUrl))).toBeNull();
  });
});

describe("tenant isolation (scenario 18)", () => {
  it("answers 404 for every endpoint when B uses A's ids, and leaves A unchanged", async () => {
    const a = await owner();
    const b = await owner();
    const aCategory = await createCategory(a.client, "Hamburguesas");
    const aProduct = await createProduct(a.client, aCategory.id);
    const aImage = await photoOf(a.client, aProduct.id);
    const bCategory = await createCategory(b.client, "Bebidas");
    const bProduct = await createProduct(b.client, bCategory.id);
    const before = await catalog(a.client);

    const attempts: [Promise<Response>, string][] = [
      [b.client.request(`/api/categories/${aCategory.id}`, json("PATCH", { name: "Hackeada" })), "CATEGORY_NOT_FOUND"],
      [b.client.request(`/api/categories/${aCategory.id}`, { method: "DELETE" }), "CATEGORY_NOT_FOUND"],
      [
        b.client.request(`/api/categories/${aCategory.id}/products/order`, json("PUT", { ids: [aProduct.id] })),
        "CATEGORY_NOT_FOUND",
      ],
      [b.client.post("/api/products", { categoryId: aCategory.id, name: "X", priceCents: 1 }), "CATEGORY_NOT_FOUND"],
      [b.client.request(`/api/products/${bProduct.id}`, json("PATCH", { categoryId: aCategory.id })), "CATEGORY_NOT_FOUND"],
      [b.client.request(`/api/products/${aProduct.id}`), "PRODUCT_NOT_FOUND"],
      [b.client.request(`/api/products/${aProduct.id}`, json("PATCH", { name: "Hackeado" })), "PRODUCT_NOT_FOUND"],
      [b.client.request(`/api/products/${aProduct.id}`, { method: "DELETE" }), "PRODUCT_NOT_FOUND"],
      [uploadPhoto(b.client, aProduct.id), "PRODUCT_NOT_FOUND"],
      [b.client.request(`/api/products/${aProduct.id}/photo`, { method: "DELETE" }), "PRODUCT_NOT_FOUND"],
    ];
    for (const [request, code] of attempts) {
      const res = await request;
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe(code);
    }

    // Foreign ids in a reorder are just "not the current set".
    const order = await b.client.request("/api/categories/order", json("PUT", { ids: [aCategory.id] }));
    expect(order.status).toBe(422);

    expect(await catalog(a.client)).toEqual(before);
    expect(await env.MEDIA.head(keyOf(aImage))).not.toBeNull();
    const bCatalog = await catalog(b.client);
    expect(bCatalog.categories.map((c) => c.id)).toEqual([bCategory.id]);
    expect(bCatalog.categories[0]?.products.map((p) => p.id)).toEqual([bProduct.id]);
    expect(bCatalog.categories[0]?.products[0]?.categoryId).toBe(bCategory.id);
  });
});

describe("asUniqueViolation", () => {
  it("reads a column constraint", () => {
    const error = asUniqueViolation(new Error("x", { cause: new Error("UNIQUE constraint failed: restaurants.slug") }));
    expect(error).toBeInstanceOf(UniqueViolationError);
    expect(error).toMatchObject({ table: "restaurants", column: "slug" });
  });

  it("reads an expression index", () => {
    const error = asUniqueViolation(new Error("D1_ERROR: UNIQUE constraint failed: index 'categories_restaurant_name_unique'"));
    expect(error).toMatchObject({ table: null, column: "categories_restaurant_name_unique" });
  });

  it("returns null for other errors", () => {
    expect(asUniqueViolation(new Error("FOREIGN KEY constraint failed"))).toBeNull();
    expect(asUniqueViolation("nope")).toBeNull();
  });
});

describe("catalog service photo ordering (no R2)", () => {
  const restaurant = { id: "r1", ownerId: "u1", plan: "basic" } as RestaurantRow;
  const product = { id: "p1", restaurantId: "r1", imageUrl: "/api/media/products/r1/old.webp" } as ProductRow;

  function service(storage: MediaStorage, updateImageUrl: ProductsRepository["updateImageUrl"]) {
    return createCatalogService({
      restaurants: { findByOwner: async () => restaurant } as never,
      categories: {} as never,
      products: { find: async () => product, updateImageUrl } as unknown as ProductsRepository,
      ingredients: {} as never,
      storage,
    });
  }

  const upload = { bytes: webpBytes().buffer as ArrayBuffer, contentType: "image/webp" };

  it("writes the new object, updates the database, then deletes the old one", async () => {
    const calls: string[] = [];
    const storage: MediaStorage = {
      put: async (key) => void calls.push(`put ${key.startsWith("products/r1/") ? "new" : key}`),
      get: async () => null,
      delete: async (key) => void calls.push(`delete ${key}`),
    };
    await service(storage, async () => {
      calls.push("db");
      return product;
    }).uploadProductPhoto("u1", "p1", upload);
    expect(calls).toEqual(["put new", "db", "delete products/r1/old.webp"]);
  });

  it("removes the new object when the database update fails", async () => {
    const storage = { put: vi.fn(async () => undefined), get: async () => null, delete: vi.fn(async () => undefined) };
    const failing = service(storage, async () => Promise.reject(new Error("D1 down")));
    await expect(failing.uploadProductPhoto("u1", "p1", upload)).rejects.toThrow("D1 down");
    const [putKey] = storage.put.mock.calls[0] as unknown as [string];
    expect(storage.delete).toHaveBeenCalledWith(putKey);
    expect(storage.delete).not.toHaveBeenCalledWith("products/r1/old.webp");
  });
});

// --- Customizable ingredients (spec 07) ---

const ingredient = (name: string, overrides: Partial<Ingredient> = {}): Ingredient => ({
  name,
  includedQty: 1,
  minQty: 0,
  maxQty: 3,
  extraPriceCents: 150_000,
  ...overrides,
});

const putIngredients = (client: Client, productId: string, ingredients: unknown) =>
  client.request(`/api/products/${productId}/ingredients`, json("PUT", { ingredients }));

const FLAG_ON = { ALLOW_PLAN_SWITCH: "true" };

async function setPlan(client: Client, plan: "basic" | "pro") {
  const res = await client.request("/api/restaurants/me/plan", json("PUT", { plan }));
  expect(res.status).toBe(200);
}

/** A logged-in owner on the Pro plan (the test switch is on for this client only). */
async function proOwner() {
  const result = await owner(FLAG_ON);
  await setPlan(result.client, "pro");
  return result;
}

const ingredientNames = async (client: Client, productId: string) =>
  (await getProduct(client, productId)).ingredients.map((i) => i.name);
const ingredientRowCount = async (productId: string) =>
  (await env.DB.prepare("SELECT count(*) AS n FROM ingredients WHERE product_id = ?").bind(productId).first<{ n: number }>())?.n;

describe("PUT /api/products/:id/ingredients (scenarios 4, 6, 7)", () => {
  it("replaces the list on Pro, answers it in order and keeps it after reloading", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const list = [
      ingredient("Bacon"),
      ingredient("Queso", { includedQty: 1, minQty: 1, maxQty: 2, extraPriceCents: 0 }),
      ingredient("Cebolla"),
    ];

    const res = await putIngredients(client, product.id, list);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingredients: list });
    expect((await getProduct(client, product.id)).ingredients).toEqual(list);
  });

  it("trims names and stores prices in cents", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await putIngredients(client, product.id, [ingredient("  Bacon  ", { extraPriceCents: 150_050 })]);
    expect((await getProduct(client, product.id)).ingredients).toEqual([ingredient("Bacon", { extraPriceCents: 150_050 })]);
  });

  it("replaces the whole list: edit, remove and reorder are one save (scenario 6)", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await putIngredients(client, product.id, [ingredient("A"), ingredient("B"), ingredient("C")]);

    const next = [ingredient("C"), ingredient("A", { maxQty: 5 })];
    expect((await putIngredients(client, product.id, next)).status).toBe(200);
    expect((await getProduct(client, product.id)).ingredients).toEqual(next);
    expect(await ingredientRowCount(product.id)).toBe(2);

    expect((await putIngredients(client, product.id, [])).status).toBe(200);
    expect((await getProduct(client, product.id)).ingredients).toEqual([]);
    expect(await ingredientRowCount(product.id)).toBe(0);
  });

  it("only touches the product it names", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const a = await createProduct(client, category.id, { name: "A" });
    const b = await createProduct(client, category.id, { name: "B" });
    await putIngredients(client, a.id, [ingredient("Bacon")]);
    await putIngredients(client, b.id, [ingredient("Queso"), ingredient("Cebolla")]);
    await putIngredients(client, a.id, []);
    expect(await ingredientNames(client, a.id)).toEqual([]);
    expect(await ingredientNames(client, b.id)).toEqual(["Queso", "Cebolla"]);
  });

  it("answers 403 PLAN_FEATURE on Basic and changes nothing, even with a hand-made request", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const res = await putIngredients(client, product.id, [ingredient("Bacon")]);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
    expect(await ingredientNames(client, product.id)).toEqual([]);
    expect(await ingredientRowCount(product.id)).toBe(0);
  });

  it("answers 404 PRODUCT_NOT_FOUND for an unknown id, on any plan", async () => {
    for (const { client } of [await owner(), await proOwner()]) {
      const res = await putIngredients(client, "missing", [ingredient("Bacon")]);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("PRODUCT_NOT_FOUND");
    }
  });

  it("answers 404 for another restaurant's product and leaves its list unchanged", async () => {
    const a = await proOwner();
    const b = await proOwner();
    const category = await createCategory(a.client, "Hamburguesas");
    const product = await createProduct(a.client, category.id);
    await putIngredients(a.client, product.id, [ingredient("Bacon")]);

    const res = await putIngredients(b.client, product.id, [ingredient("Hackeado")]);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("PRODUCT_NOT_FOUND");
    expect(await ingredientNames(a.client, product.id)).toEqual(["Bacon"]);
    expect((await b.client.request(`/api/products/${product.id}`)).status).toBe(404);
  });

  it.each([
    ["an empty name", [ingredient("  ")]],
    ["a name over 40 characters", [ingredient("a".repeat(41))]],
    ["a max of 0", [ingredient("Bacon", { includedQty: 0, minQty: 0, maxQty: 0 })]],
    ["min above included", [ingredient("Bacon", { includedQty: 1, minQty: 2, maxQty: 3 })]],
    ["included above max", [ingredient("Bacon", { includedQty: 4, minQty: 0, maxQty: 3 })]],
    ["a decimal quantity", [ingredient("Bacon", { includedQty: 1.5 })]],
    ["a quantity over 99", [ingredient("Bacon", { maxQty: 100 })]],
    ["a negative extra price", [ingredient("Bacon", { extraPriceCents: -1 })]],
    ["a duplicated name in another casing", [ingredient("Bacon"), ingredient("bacon")]],
    ["more than 20 ingredients", Array.from({ length: 21 }, (_, i) => ingredient(`Ingrediente ${i}`))],
    ["a list that is not an array", "Bacon"],
  ])("answers 422 VALIDATION_ERROR for %s and keeps the saved list", async (_label, list) => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await putIngredients(client, product.id, [ingredient("Queso")]);

    const res = await putIngredients(client, product.id, list);
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    expect(await ingredientNames(client, product.id)).toEqual(["Queso"]);
  });

  it("accepts exactly 20 ingredients", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const list = Array.from({ length: 20 }, (_, i) => ingredient(`Ingrediente ${i}`));
    expect((await putIngredients(client, product.id, list)).status).toBe(200);
    expect(await ingredientNames(client, product.id)).toEqual(list.map((i) => i.name));
  });

  it("answers 422 for a body that is not JSON", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const res = await client.request(`/api/products/${product.id}/ingredients`, { method: "PUT", body: "nope" });
    expect(res.status).toBe(422);
  });

  it("checks the plan with the injected limits (PlanFeatureError)", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const userId = ((await client.session())?.user as unknown as { id: string }).id;
    const service = createCatalogService({
      restaurants: createRestaurantsRepository(env.DB),
      categories: createCategoriesRepository(env.DB),
      products: createProductsRepository(env.DB),
      ingredients: createIngredientsRepository(env.DB),
      storage: createMediaStorage(env.MEDIA),
      limitsFor: () => ({ maxProducts: null, productPhotos: true, customIngredients: false }),
    });
    await expect(service.replaceIngredients(userId, product.id, [ingredient("Bacon")])).rejects.toBeInstanceOf(PlanFeatureError);
    expect(await ingredientNames(client, product.id)).toEqual([]);
  });
});

describe("ingredients in catalog reads (scenario 8)", () => {
  it("carries an empty ingredients array on every plan when there are none", async () => {
    const { client } = await owner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    expect(product.ingredients).toEqual([]);
    expect((await getProduct(client, product.id)).ingredients).toEqual([]);
    expect((await catalog(client)).categories[0]?.products[0]?.ingredients).toEqual([]);
  });

  it("carries each product's own ingredients, in order, in the catalog and in the product", async () => {
    const { client } = await proOwner();
    const burgers = await createCategory(client, "Hamburguesas");
    const drinks = await createCategory(client, "Bebidas");
    const a = await createProduct(client, burgers.id, { name: "A" });
    const b = await createProduct(client, burgers.id, { name: "B" });
    const c = await createProduct(client, drinks.id, { name: "C" });
    await putIngredients(client, a.id, [ingredient("Queso"), ingredient("Bacon")]);
    await putIngredients(client, c.id, [ingredient("Hielo")]);

    const { categories } = await catalog(client);
    const byName = Object.fromEntries(
      categories.flatMap((cat) => cat.products).map((p) => [p.name, p.ingredients.map((i) => i.name)]),
    );
    expect(byName).toEqual({ A: ["Queso", "Bacon"], B: [], C: ["Hielo"] });
    expect(await ingredientNames(client, b.id)).toEqual([]);
  });

  it("keeps the ingredients when the product is edited or moved", async () => {
    const { client } = await proOwner();
    const burgers = await createCategory(client, "Hamburguesas");
    const drinks = await createCategory(client, "Bebidas");
    const product = await createProduct(client, burgers.id);
    await putIngredients(client, product.id, [ingredient("Bacon")]);
    const res = await client.request(`/api/products/${product.id}`, json("PATCH", { categoryId: drinks.id, name: "Otra" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Product).ingredients).toEqual([ingredient("Bacon")]);
    expect(await ingredientNames(client, product.id)).toEqual(["Bacon"]);
  });

  it("never shows another restaurant's ingredients", async () => {
    const a = await proOwner();
    const b = await proOwner();
    const category = await createCategory(a.client, "Hamburguesas");
    await putIngredients(a.client, (await createProduct(a.client, category.id)).id, [ingredient("Bacon")]);
    const bCategory = await createCategory(b.client, "Bebidas");
    await createProduct(b.client, bCategory.id);
    expect((await catalog(b.client)).categories[0]?.products[0]?.ingredients).toEqual([]);
  });
});

describe("downgrade keeps ingredients (scenario 9)", () => {
  it("keeps, shows and protects the saved list until the account is Pro again", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    const saved = [ingredient("Bacon"), ingredient("Queso")];
    await putIngredients(client, product.id, saved);

    await setPlan(client, "basic");
    expect((await getProduct(client, product.id)).ingredients).toEqual(saved);
    expect((await catalog(client)).categories[0]?.products[0]?.ingredients).toEqual(saved);

    for (const list of [[ingredient("Otro")], []]) {
      const res = await putIngredients(client, product.id, list);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("PLAN_FEATURE");
    }
    expect((await getProduct(client, product.id)).ingredients).toEqual(saved);

    await setPlan(client, "pro");
    expect((await putIngredients(client, product.id, [ingredient("Otro")])).status).toBe(200);
    expect(await ingredientNames(client, product.id)).toEqual(["Otro"]);
  });
});

describe("ingredients are deleted with their product (scenario 10)", () => {
  it("leaves no rows after deleting the product, and keeps other products' rows", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id, { name: "A" });
    const other = await createProduct(client, category.id, { name: "B" });
    await putIngredients(client, product.id, [ingredient("Bacon"), ingredient("Queso")]);
    await putIngredients(client, other.id, [ingredient("Cebolla")]);
    expect(await ingredientRowCount(product.id)).toBe(2);

    expect((await client.request(`/api/products/${product.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await ingredientRowCount(product.id)).toBe(0);
    expect(await ingredientRowCount(other.id)).toBe(1);
  });

  it("leaves no rows after deleting the restaurant", async () => {
    const { client, restaurant } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await putIngredients(client, product.id, [ingredient("Bacon")]);

    await env.DB.prepare("DELETE FROM restaurants WHERE id = ?").bind(restaurant.id).run();
    expect(await ingredientRowCount(product.id)).toBe(0);
  });
});

describe("ingredients repository", () => {
  it("keeps the old list when the replacement fails midway (one atomic batch)", async () => {
    const { client } = await proOwner();
    const category = await createCategory(client, "Hamburguesas");
    const product = await createProduct(client, category.id);
    await putIngredients(client, product.id, [ingredient("Queso")]);

    const repository = createIngredientsRepository(env.DB);
    const row = (name: string | null, position: number) => ({
      id: crypto.randomUUID(),
      productId: product.id,
      name: name as string,
      includedQty: 1,
      minQty: 0,
      maxQty: 3,
      extraPriceCents: 0,
      position,
    });
    await expect(repository.replace(product.id, [row("Nuevo", 0), row(null, 1)])).rejects.toThrow();
    expect(await ingredientNames(client, product.id)).toEqual(["Queso"]);
  });

  it("reports a missing product as a foreign key violation", async () => {
    const repository = createIngredientsRepository(env.DB);
    await expect(
      repository.replace("missing", [
        { id: crypto.randomUUID(), productId: "missing", name: "X", includedQty: 1, minQty: 0, maxQty: 1, extraPriceCents: 0, position: 0 },
      ]),
    ).rejects.toMatchObject({ name: "ForeignKeyViolationError" });
  });
});
