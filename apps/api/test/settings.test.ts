import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PublicMenu, Restaurant, StoreSettings } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;

async function loggedInClient() {
  const email = `settings${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
  const client = new Client();
  await client.open(sink.last().link);
  return client;
}

async function createRestaurant(client: Client, slug = `settings-${unique()}`) {
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Restaurant;
}

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("GET /api/restaurants/me/settings (scenario 10)", () => {
  it("answers 401 without a session", async () => {
    const res = await new Client().get("/api/restaurants/me/settings");
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("answers 404 RESTAURANT_NOT_FOUND when user has no restaurant", async () => {
    const client = await loggedInClient();
    const res = await client.get("/api/restaurants/me/settings");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
  });

  it("responds with the default settings and both payment methods present", async () => {
    const client = await loggedInClient();
    await createRestaurant(client);

    const res = await client.get("/api/restaurants/me/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as StoreSettings;
    expect(body.acceptingOrders).toBe(true);
    expect(body.minOrderCents).toBeNull();
    expect(body.shippingCents).toBe(0);
    expect(body.paymentMethods).toEqual([
      { method: "cash", enabled: true, alias: null, holderName: null },
      { method: "transfer", enabled: false, alias: null, holderName: null },
    ]);
  });
});

describe("PATCH /api/restaurants/me/settings (scenario 11)", () => {
  it("updates partial fields without touching the rest", async () => {
    const client = await loggedInClient();
    await createRestaurant(client);

    // Pausing without touching anything else
    const pauseRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: false }),
    });
    expect(pauseRes.status).toBe(200);
    const paused = (await pauseRes.json()) as StoreSettings;
    expect(paused.acceptingOrders).toBe(false);
    expect(paused.minOrderCents).toBeNull();
    expect(paused.shippingCents).toBe(0);
    expect(paused.paymentMethods[0]?.enabled).toBe(true);

    // Setting minOrder and shipping
    const amountsRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 500000, shippingCents: 150000 }),
    });
    expect(amountsRes.status).toBe(200);
    const amounts = (await amountsRes.json()) as StoreSettings;
    expect(amounts.acceptingOrders).toBe(false);
    expect(amounts.minOrderCents).toBe(500000);
    expect(amounts.shippingCents).toBe(150000);

    // Removing minOrder
    const nullMinRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: null }),
    });
    expect(nullMinRes.status).toBe(200);
    expect(((await nullMinRes.json()) as StoreSettings).minOrderCents).toBeNull();

    // Enabling transfer with alias and holder
    const transferRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [
          { method: "transfer", enabled: true, alias: "mi.local.mp", holderName: "Marta Gómez" },
        ],
      }),
    });
    expect(transferRes.status).toBe(200);
    const transfer = (await transferRes.json()) as StoreSettings;
    const transferMethod = transfer.paymentMethods.find((pm) => pm.method === "transfer");
    expect(transferMethod).toEqual({
      method: "transfer",
      enabled: true,
      alias: "mi.local.mp",
      holderName: "Marta Gómez",
    });
    // cash remains enabled
    const cashMethod = transfer.paymentMethods.find((pm) => pm.method === "cash");
    expect(cashMethod?.enabled).toBe(true);
  });

  it("rejects invalid resulting states with 422 VALIDATION_ERROR and changes nothing", async () => {
    const client = await loggedInClient();
    await createRestaurant(client);

    // Empty body
    const emptyRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(emptyRes.status).toBe(422);

    // Disabling only enabled method
    const noMethodRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [{ method: "cash", enabled: false }],
      }),
    });
    expect(noMethodRes.status).toBe(422);
    expect(await errorCode(noMethodRes)).toBe("VALIDATION_ERROR");

    // Enabling transfer without alias or without holder
    const missingAliasRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [{ method: "transfer", enabled: true, alias: "", holderName: "Juan" }],
      }),
    });
    expect(missingAliasRes.status).toBe(422);

    const missingHolderRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [{ method: "transfer", enabled: true, alias: "mi.alias", holderName: " " }],
      }),
    });
    expect(missingHolderRes.status).toBe(422);

    // Min order 0 or negative
    const zeroMinRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 0 }),
    });
    expect(zeroMinRes.status).toBe(422);

    // Shipping negative
    const negShipRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ shippingCents: -100 }),
    });
    expect(negShipRes.status).toBe(422);

    // Verify settings were not modified
    const current = (await (await client.get("/api/restaurants/me/settings")).json()) as StoreSettings;
    expect(current.minOrderCents).toBeNull();
    expect(current.shippingCents).toBe(0);
    expect(current.paymentMethods.find((pm) => pm.method === "cash")?.enabled).toBe(true);
  });

  it("keeps the stored alias and holder when a method is sent without them", async () => {
    const client = await loggedInClient();
    await createRestaurant(client);
    const patch = (body: unknown) =>
      client.request("/api/restaurants/me/settings", { method: "PATCH", body: JSON.stringify(body) });

    const saved = await patch({
      paymentMethods: [{ method: "transfer", enabled: true, alias: "mi.alias", holderName: "Marta Gomez" }],
    });
    expect(saved.status).toBe(200);

    const disabled = await patch({ paymentMethods: [{ method: "transfer", enabled: false }] });
    expect(disabled.status).toBe(200);
    const reenabled = await patch({ paymentMethods: [{ method: "transfer", enabled: true }] });
    expect(reenabled.status).toBe(200);

    const current = (await (await client.get("/api/restaurants/me/settings")).json()) as StoreSettings;
    expect(current.paymentMethods.find((pm) => pm.method === "transfer")).toEqual({
      method: "transfer",
      enabled: true,
      alias: "mi.alias",
      holderName: "Marta Gomez",
    });
  });

  it("lets a backfilled store with transfer enabled and no alias change its minimum and shipping (scenario 48)", async () => {
    const client = await loggedInClient();
    const restaurant = await createRestaurant(client);
    await env.DB.prepare(
      "UPDATE restaurant_payment_methods SET enabled = 1, alias = NULL, holder_name = NULL WHERE restaurant_id = ? AND method = 'transfer'",
    )
      .bind(restaurant.id)
      .run();

    const res = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 500_000, shippingCents: 50_000 }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as StoreSettings;
    expect(updated.minOrderCents).toBe(500_000);
    expect(updated.shippingCents).toBe(50_000);

    // Touching the methods still requires the transfer details
    const methodsRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ paymentMethods: [{ method: "cash", enabled: true }] }),
    });
    expect(methodsRes.status).toBe(422);
  });

  it("rejects enabling transfer when the stored method has no alias and changes nothing", async () => {
    const client = await loggedInClient();
    await createRestaurant(client);
    const before = (await (await client.get("/api/restaurants/me/settings")).json()) as StoreSettings;

    const res = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ shippingCents: 50_000, paymentMethods: [{ method: "transfer", enabled: true }] }),
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");

    const after = (await (await client.get("/api/restaurants/me/settings")).json()) as StoreSettings;
    expect(after).toEqual(before);
  });
});

describe("tenant isolation and plan independence (scenario 12)", () => {
  it("isolates settings between two owners A and B and ignores restaurantId in body", async () => {
    const clientA = await loggedInClient();
    await createRestaurant(clientA);

    const clientB = await loggedInClient();
    const restB = await createRestaurant(clientB);

    // A updates settings
    await clientA.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        restaurantId: restB.id, // should be ignored
        minOrderCents: 1000000,
        shippingCents: 200000,
      }),
    });

    // B remains on defaults
    const bSettings = (await (await clientB.get("/api/restaurants/me/settings")).json()) as StoreSettings;
    expect(bSettings.minOrderCents).toBeNull();
    expect(bSettings.shippingCents).toBe(0);

    // B sets Pro plan, behaves identically
    await env.DB.prepare("UPDATE restaurants SET plan = 'pro' WHERE id = ?").bind(restB.id).run();
    const bProPatch = await clientB.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 300000 }),
    });
    expect(bProPatch.status).toBe(200);
    expect(((await bProPatch.json()) as StoreSettings).minOrderCents).toBe(300000);
  });
});

describe("public menu publishes store settings (scenario 13)", () => {
  it("publishes acceptingOrders, minOrderCents, shippingCents and only enabled payment methods", async () => {
    const client = await loggedInClient();
    const restaurant = await createRestaurant(client);

    // Add a category and product so public menu is not 404
    const catRes = await client.post("/api/categories", { name: "Platos" });
    const cat = (await catRes.json()) as { id: string };
    await client.post("/api/products", {
      categoryId: cat.id,
      name: "Milanesa",
      priceCents: 500000,
    });

    // Configure settings: pause = false, minOrder = 400000, shipping = 150000, both methods enabled
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        acceptingOrders: false,
        minOrderCents: 400000,
        shippingCents: 150000,
        paymentMethods: [
          { method: "cash", enabled: true },
          { method: "transfer", enabled: true, alias: "mi.alias.mp", holderName: "Marta Gómez" },
        ],
      }),
    });

    const publicRes = await new Client().get(`/api/public/menus/${restaurant.slug}`);
    expect(publicRes.status).toBe(200);
    const menu = (await publicRes.json()) as PublicMenu;

    expect(menu.restaurant.acceptingOrders).toBe(false);
    expect(menu.restaurant.minOrderCents).toBe(400000);
    expect(menu.restaurant.shippingCents).toBe(150000);
    expect(menu.restaurant.paymentMethods).toEqual([
      { method: "cash", alias: null, holderName: null },
      { method: "transfer", alias: "mi.alias.mp", holderName: "Marta Gómez" },
    ]);
  });

  it("uses safe defaults if settings row is missing in the database", async () => {
    const client = await loggedInClient();
    const restaurant = await createRestaurant(client);

    const catRes = await client.post("/api/categories", { name: "Platos" });
    const cat = (await catRes.json()) as { id: string };
    await client.post("/api/products", {
      categoryId: cat.id,
      name: "Milanesa",
      priceCents: 500000,
    });

    // Delete settings row to simulate damaged data
    await env.DB.prepare("DELETE FROM restaurant_settings WHERE restaurant_id = ?").bind(restaurant.id).run();

    const publicRes = await new Client().get(`/api/public/menus/${restaurant.slug}`);
    expect(publicRes.status).toBe(200);
    const menu = (await publicRes.json()) as PublicMenu;

    expect(menu.restaurant.acceptingOrders).toBe(true);
    expect(menu.restaurant.minOrderCents).toBeNull();
    expect(menu.restaurant.shippingCents).toBe(0);
    expect(menu.restaurant.paymentMethods).toEqual([
      { method: "cash", alias: null, holderName: null },
    ]);
  });
});
