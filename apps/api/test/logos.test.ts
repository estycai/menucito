import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_MAX_BYTES, type LogoUploadResult, type Restaurant } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";
import type { RestaurantRow } from "../src/db/schema";
import type { RestaurantsRepository } from "../src/repositories/restaurants";
import { createLogoService } from "../src/services/logos";
import type { MediaStorage } from "../src/storage/media";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** Signs up, verifies (which opens a session) and returns the logged-in client. */
async function loggedInClient() {
  const email = `logo${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  return client;
}

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function ownerWithRestaurant() {
  const client = await loggedInClient();
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `lo-de-marta-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

/** Bytes with a valid WebP container header (`RIFF....WEBP`), padded to `size`. */
function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  return bytes;
}

const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

function uploadLogo(client: Client, bytes: Uint8Array, type = "image/webp") {
  const form = new FormData();
  form.append("file", new File([bytes], "logo.webp", { type }));
  return client.request("/api/restaurants/me/logo", { method: "PUT", body: form });
}

const me = async (client: Client) => (await (await client.request("/api/restaurants/me")).json()) as Restaurant;
const keyOf = (logoUrl: string) => logoUrl.replace("/api/media/", "");
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("authentication (scenario 9)", () => {
  it("PUT /api/restaurants/me/logo answers 401 without a session", async () => {
    const res = await uploadLogo(new Client(), webpBytes());
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("DELETE /api/restaurants/me/logo answers 401 without a session", async () => {
    const res = await new Client().request("/api/restaurants/me/logo", { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});

describe("PUT /api/restaurants/me/logo", () => {
  it("lets a Basic plan restaurant upload a logo, stored in R2 and exposed in /me (scenario 5)", async () => {
    const { client, restaurant } = await ownerWithRestaurant();
    expect(restaurant.plan).toBe("basic");
    expect(restaurant.logoUrl).toBeNull();

    const res = await uploadLogo(client, webpBytes());
    expect(res.status).toBe(200);
    const { logoUrl } = (await res.json()) as LogoUploadResult;
    expect(logoUrl).toMatch(new RegExp(`^/api/media/logos/${restaurant.id}/[0-9a-f-]{36}\\.webp$`));

    expect((await me(client)).logoUrl).toBe(logoUrl);
    const object = await env.MEDIA.get(keyOf(logoUrl));
    expect(object?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("replaces the logo and deletes the old object from R2 (scenario 3)", async () => {
    const { client } = await ownerWithRestaurant();
    const first = ((await (await uploadLogo(client, webpBytes())).json()) as LogoUploadResult).logoUrl;
    const second = ((await (await uploadLogo(client, webpBytes(80))).json()) as LogoUploadResult).logoUrl;

    expect(second).not.toBe(first);
    expect((await me(client)).logoUrl).toBe(second);
    expect(await env.MEDIA.head(keyOf(first))).toBeNull();
    expect(await env.MEDIA.head(keyOf(second))).not.toBeNull();
  });

  it.each([
    ["a Content-Type other than image/webp", webpBytes(), "image/png"],
    ["bytes that are not WebP (bad magic bytes)", pngBytes(), "image/webp"],
    ["an empty file", new Uint8Array(), "image/webp"],
  ])("answers 415 for %s (scenario 7)", async (_label, bytes, type) => {
    const { client } = await ownerWithRestaurant();
    const res = await uploadLogo(client, bytes, type);
    expect(res.status).toBe(415);
    expect(await errorCode(res)).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect((await me(client)).logoUrl).toBeNull();
  });

  it("answers 415 when the body is not multipart (scenario 7)", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await client.request("/api/restaurants/me/logo", {
      method: "PUT",
      body: new Blob([webpBytes()], { type: "image/webp" }),
      headers: { "Content-Type": "image/webp" },
    });
    expect(res.status).toBe(415);
  });

  it("answers 413 for a file over 1 MB (scenario 8)", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await uploadLogo(client, webpBytes(LOGO_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("FILE_TOO_LARGE");
    expect((await me(client)).logoUrl).toBeNull();
  });

  it("answers 413 for a much larger body before reading it (scenario 8)", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await uploadLogo(client, webpBytes(3 * LOGO_MAX_BYTES));
    expect(res.status).toBe(413);
  });

  it("accepts a file of exactly 1 MB", async () => {
    const { client } = await ownerWithRestaurant();
    expect((await uploadLogo(client, webpBytes(LOGO_MAX_BYTES))).status).toBe(200);
  });

  it("answers 422 when the file field is missing", async () => {
    const { client } = await ownerWithRestaurant();
    const form = new FormData();
    form.append("other", "x");
    const res = await client.request("/api/restaurants/me/logo", { method: "PUT", body: form });
    expect(res.status).toBe(422);
  });

  it("answers 404 when the user has no restaurant", async () => {
    const client = await loggedInClient();
    const res = await uploadLogo(client, webpBytes());
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
  });
});

describe("DELETE /api/restaurants/me/logo (scenario 4)", () => {
  it("removes the object and clears logo_url", async () => {
    const { client } = await ownerWithRestaurant();
    const { logoUrl } = (await (await uploadLogo(client, webpBytes())).json()) as LogoUploadResult;

    const res = await client.request("/api/restaurants/me/logo", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await me(client)).logoUrl).toBeNull();
    expect(await env.MEDIA.head(keyOf(logoUrl))).toBeNull();
  });

  it("answers 204 when there is no logo", async () => {
    const { client } = await ownerWithRestaurant();
    const res = await client.request("/api/restaurants/me/logo", { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

describe("GET /api/media/* (scenario 10)", () => {
  it("serves the logo publicly as image/webp with immutable cache and nosniff", async () => {
    const { client } = await ownerWithRestaurant();
    const bytes = webpBytes(100);
    const { logoUrl } = (await (await uploadLogo(client, bytes)).json()) as LogoUploadResult;

    const res = await new Client().request(logoUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    "/api/media/logos/missing/00000000-0000-0000-0000-000000000000.webp",
    "/api/media/logos/x/../secret.webp",
    "/api/media/other/file.svg",
    "/api/media/",
  ])("answers 404 for %s", async (path) => {
    const res = await new Client().request(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("logo service (no database)", () => {
  const row = { id: "r1", ownerId: "u1", plan: "basic", logoUrl: "/api/media/logos/r1/old.webp" } as RestaurantRow;

  function fakes(overrides: Partial<MediaStorage> = {}) {
    const repository = {
      findByOwner: async () => row,
      findBySlug: async () => null,
      insert: async () => row,
      updateLogoUrl: vi.fn(async () => row),
    } satisfies RestaurantsRepository;
    const storage: MediaStorage = {
      put: vi.fn(async () => undefined),
      get: async () => null,
      delete: vi.fn(async () => undefined),
      ...overrides,
    };
    return { repository, storage };
  }

  const upload = { bytes: webpBytes().buffer as ArrayBuffer, contentType: "image/webp" };

  it("does not fail the upload when deleting the old object fails (it logs instead)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { repository, storage } = fakes({ delete: async () => Promise.reject(new Error("R2 down")) });
    const result = await createLogoService(repository, storage).uploadLogo("u1", upload);
    expect(result.logoUrl).toMatch(/^\/api\/media\/logos\/r1\/.+\.webp$/);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("writes the new object before updating the database, and deletes the old one last", async () => {
    const calls: string[] = [];
    const { repository, storage } = fakes({
      put: async (key) => void calls.push(`put ${key.startsWith("logos/r1/") ? "new" : key}`),
      delete: async (key) => void calls.push(`delete ${key}`),
    });
    repository.updateLogoUrl.mockImplementation(async () => {
      calls.push("db");
      return row;
    });
    await createLogoService(repository, storage).uploadLogo("u1", upload);
    expect(calls).toEqual(["put new", "db", "delete logos/r1/old.webp"]);
  });

  it("removes the new object when the database update fails", async () => {
    const { repository, storage } = fakes();
    repository.updateLogoUrl.mockRejectedValue(new Error("D1 down"));
    await expect(createLogoService(repository, storage).uploadLogo("u1", upload)).rejects.toThrow("D1 down");
    const [putKey] = vi.mocked(storage.put).mock.calls[0] ?? [];
    expect(storage.delete).toHaveBeenCalledWith(putKey);
  });
});
