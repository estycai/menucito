import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Restaurant } from "@menucito/shared";
import { createRestaurantsRepository } from "../src/repositories/restaurants";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

/** Signs up a verified user and returns it logged in, together with its id. */
async function loggedInUser() {
  const email = `storage${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  return { client, userId: row!.id };
}

async function owner() {
  const { client, userId } = await loggedInUser();
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `storage-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, userId, restaurant: (await res.json()) as Restaurant };
}

const appearanceRow = (restaurantId: string) =>
  env.DB.prepare("SELECT * FROM restaurant_appearance WHERE restaurant_id = ?").bind(restaurantId).first();

/** Bytes with a valid WebP container header. */
function webpBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  return bytes;
}

function putImage(client: Client, path: string, name: string) {
  const form = new FormData();
  form.append("file", new File([webpBytes()], name, { type: "image/webp" }));
  return client.request(path, { method: "PUT", body: form });
}

describe("restaurant_appearance storage", () => {
  it("creates the appearance row with its defaults together with the restaurant", async () => {
    const { restaurant } = await owner();
    expect(await appearanceRow(restaurant.id)).toMatchObject({
      restaurant_id: restaurant.id,
      logo_url: null,
      cover_url: null,
      description: "",
      bg_color: null,
      primary_color: null,
    });
  });

  it("creates neither row when the insert fails (one batch)", async () => {
    const taken = await owner();
    const { userId } = await loggedInUser();
    const id = crypto.randomUUID();
    const now = new Date();

    await expect(
      createRestaurantsRepository(env.DB).insert({
        id,
        ownerId: userId,
        slug: taken.restaurant.slug,
        name: "Duplicado",
        whatsapp: "5491112345678",
        delivery: true,
        takeaway: true,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toMatchObject({ name: "UniqueViolationError", column: "slug" });
    expect(await appearanceRow(id)).toBeNull();
  });

  it("no longer keeps the appearance columns in restaurants", async () => {
    const columns = (await env.DB.prepare("SELECT name FROM pragma_table_info('restaurants')").all<{ name: string }>()).results.map(
      (c) => c.name,
    );
    for (const moved of ["logo_url", "cover_url", "description", "bg_color", "primary_color"]) {
      expect(columns).not.toContain(moved);
    }
    expect(columns).toEqual(expect.arrayContaining(["plan", "status", "delivery", "takeaway"]));
  });

  it("writes the logo, cover, description and colors to restaurant_appearance, and clears the logo", async () => {
    const { client, restaurant } = await owner();
    await env.DB.prepare("UPDATE restaurants SET plan = 'pro' WHERE id = ?").bind(restaurant.id).run();

    const { logoUrl } = (await (await putImage(client, "/api/restaurants/me/logo", "logo.webp")).json()) as { logoUrl: string };
    const { coverUrl } = (await (await putImage(client, "/api/restaurants/me/cover", "cover.webp")).json()) as {
      coverUrl: string;
    };
    const patched = await client.request("/api/restaurants/me/appearance", {
      method: "PATCH",
      body: JSON.stringify({ description: "Cocina casera", bgColor: "#1c1917", primaryColor: "#16a34a" }),
    });
    expect(patched.status).toBe(200);

    expect(await appearanceRow(restaurant.id)).toMatchObject({
      logo_url: logoUrl,
      cover_url: coverUrl,
      description: "Cocina casera",
      bg_color: "#1C1917",
      primary_color: "#16A34A",
    });

    expect((await client.request("/api/restaurants/me/logo", { method: "DELETE" })).status).toBe(204);
    expect(await appearanceRow(restaurant.id)).toMatchObject({ logo_url: null, cover_url: coverUrl });
  });

  it("keeps the appearance when the plan changes, and reports the latest updatedAt of both rows", async () => {
    const { client, userId, restaurant } = await owner();
    await client.request("/api/restaurants/me/appearance", { method: "PATCH", body: JSON.stringify({ description: "Hola" }) });

    const repository = createRestaurantsRepository(env.DB);
    const before = await repository.findByOwner(userId);
    const updated = await repository.updatePlan(restaurant.id, "pro", new Date(Date.now() + 60_000));
    expect(updated).toMatchObject({ plan: "pro", description: "Hola" });
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it("returns null when updating an unknown restaurant", async () => {
    const repository = createRestaurantsRepository(env.DB);
    expect(await repository.updateLogoUrl("missing", "/x", new Date())).toBeNull();
    expect(await repository.updateCoverUrl("missing", "/x", new Date())).toBeNull();
    expect(await repository.updateAppearance("missing", { description: "x" }, new Date())).toBeNull();
    expect(await repository.updatePlan("missing", "pro", new Date())).toBeNull();
  });

  it("creates the store settings and default payment methods in the same batch (scenario 9)", async () => {
    const { restaurant } = await owner();
    const settings = await env.DB.prepare("SELECT * FROM restaurant_settings WHERE restaurant_id = ?")
      .bind(restaurant.id)
      .first<{
        restaurant_id: string;
        accepting_orders: number;
        min_order_cents: number | null;
        shipping_cents: number;
      }>();
    expect(settings).toMatchObject({
      restaurant_id: restaurant.id,
      accepting_orders: 1,
      min_order_cents: null,
      shipping_cents: 0,
    });

    const methods = (
      await env.DB.prepare("SELECT * FROM restaurant_payment_methods WHERE restaurant_id = ? ORDER BY method")
        .bind(restaurant.id)
        .all<{
          restaurant_id: string;
          method: string;
          enabled: number;
          alias: string | null;
          holder_name: string | null;
        }>()
    ).results;
    expect(methods).toEqual([
      { restaurant_id: restaurant.id, method: "cash", enabled: 1, alias: null, holder_name: null },
      { restaurant_id: restaurant.id, method: "transfer", enabled: 0, alias: null, holder_name: null },
    ]);
  });

  it("deletes the appearance row with the restaurant", async () => {
    const { restaurant } = await owner();
    await env.DB.prepare("DELETE FROM restaurants WHERE id = ?").bind(restaurant.id).run();
    expect(await appearanceRow(restaurant.id)).toBeNull();
  });
});
