import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { localWeekTime, type Category, type Product } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient, type OwnerFixture } from "./helpers";

const localWeekTimeFor = localWeekTime;

async function createCatalog(owner: OwnerFixture) {
  const categoryRes = await owner.client.post("/api/categories", { name: "Burgers" });
  expect(categoryRes.status).toBe(201);
  const category = (await categoryRes.json()) as Category;
  const productRes = await owner.client.post("/api/products", {
    categoryId: category.id,
    name: "Hamburguesa completa",
    description: "Carne, queso y huevo",
    priceCents: 900_000,
    available: true,
  });
  expect(productRes.status).toBe(201);
  return (await productRes.json()) as Product;
}

function payload(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan Pérez", phone: "11 5555-1234" },
    fulfillment: "takeaway",
    paymentMethod: "cash",
    source: "whatsapp",
    clientOrderId: crypto.randomUUID(),
    expectedTotalCents: 900_000,
    ...overrides,
  };
}

const orderRow = (restaurantId: string, number: number) =>
  env.DB.prepare("SELECT * FROM orders WHERE restaurant_id = ? AND number = ?")
    .bind(restaurantId, number)
    .first<Record<string, unknown>>();

describe("15b: POST /api/orders", () => {
  it("creates a takeaway order loaded from WhatsApp, in new and pending", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);

    const res = await owner.client.post("/api/orders", payload(product.id));
    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      id: string;
      number: number;
      source: string;
      status: string;
      paymentStatus: string;
      customerPhone: string;
      notes: string | null;
    };
    expect(order).toMatchObject({
      number: 1,
      source: "whatsapp",
      status: "new",
      paymentStatus: "pending",
      customerPhone: "5491155551234",
      notes: null,
    });

    const row = await orderRow(owner.restaurantId, 1);
    expect(row?.source).toBe("whatsapp");
    expect(row?.notes).toBeNull();
  });

  it("creates a flat delivery with its shipping, and a Local without phone stores an empty one", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    await owner.client.patch("/api/restaurants/me/settings", { shippingCents: 50_000 });

    const res = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        source: "local",
        fulfillment: "delivery",
        customer: { name: "Mostrador", address: "Av. Corrientes 1234" },
        notes: "  tocar timbre 2B  ",
        expectedTotalCents: 950_000,
      }),
    );
    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      customerPhone: string;
      deliveryAddress: string;
      notes: string;
      shippingCents: number;
      totalCents: number;
    };
    expect(order.customerPhone).toBe("");
    expect(order.deliveryAddress).toBe("Av. Corrientes 1234");
    expect(order.notes).toBe("tocar timbre 2B");
    expect(order.shippingCents).toBe(50_000);
    expect(order.totalCents).toBe(950_000);
  });

  it("creates a zones delivery with the quoted shipping and rejects an address outside every zone", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const location = {
      deliveryMode: "zones",
      address: "Av. Corrientes 1234, CABA",
      addressNotes: null,
      lat: -34.6037,
      lng: -58.3816,
      placeId: null,
    };
    expect((await owner.client.put("/api/restaurants/me/location", location)).status).toBe(200);
    const zones = await owner.client.put("/api/restaurants/me/delivery-zones", {
      zones: [
        {
          name: "Centro",
          color: "#C2410C",
          active: true,
          shape: "radius",
          radiusM: 2000,
          pricing: "fixed",
          priceCents: 50_000,
        },
      ],
    });
    expect(zones.status).toBe(200);

    const delivery = {
      placeId: null,
      lat: -34.603,
      lng: -58.381,
      formattedAddress: "Av. Corrientes 1234",
      locality: "CABA",
      unit: null,
      betweenStreets: null,
      label: null,
    };
    const inside = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        fulfillment: "delivery",
        customer: { name: "Juan", phone: "11 5555 1234", address: "Av. Corrientes 1234" },
        delivery,
        expectedTotalCents: 950_000,
      }),
    );
    expect(inside.status).toBe(201);
    expect(((await inside.json()) as { shippingCents: number }).shippingCents).toBe(50_000);

    const outside = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        fulfillment: "delivery",
        customer: { name: "Juan", phone: "11 5555 1234", address: "Lejos 999" },
        delivery: { ...delivery, lat: -34.7, lng: -58.5, formattedAddress: "Lejos 999" },
        expectedTotalCents: 900_000,
      }),
    );
    expect(outside.status).toBe(422);
    expect(await errorCode(outside)).toBe("OUT_OF_COVERAGE");

    const quote = await owner.client.post("/api/orders/delivery-quote", {
      lat: -34.603,
      lng: -58.381,
      subtotalCents: 900_000,
    });
    expect(quote.status).toBe(200);
    expect(await quote.json()).toEqual({ covered: true, shippingCents: 50_000, minOrderCents: null });
  });

  it("works while the store is paused and outside its hours, and ignores the phone throttle", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    await owner.client.patch("/api/restaurants/me/settings", { acceptingOrders: false });

    const { weekday, minutes } = localWeekTimeFor(new Date());
    const hours = await owner.client.put("/api/restaurants/me/hours", {
      slots: [
        {
          weekday,
          opensAt: (minutes + 10) % 1440,
          closesAt: (minutes + 20) % 1440,
          fulfillment: "all",
        },
      ],
    });
    expect(hours.status).toBe(200);

    for (let i = 0; i < 4; i++) {
      const res = await owner.client.post("/api/orders", payload(product.id));
      expect(res.status).toBe(201);
    }
  });

  it("rejects a disabled fulfillment or payment method", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    await env.DB.prepare("UPDATE restaurants SET delivery = 0 WHERE id = ?").bind(owner.restaurantId).run();

    const delivery = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        fulfillment: "delivery",
        customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
        expectedTotalCents: 900_000,
      }),
    );
    expect(delivery.status).toBe(409);
    expect(await errorCode(delivery)).toBe("FULFILLMENT_NOT_OFFERED");

    const transfer = await owner.client.post("/api/orders", payload(product.id, { paymentMethod: "transfer" }));
    expect(transfer.status).toBe(409);
    expect(await errorCode(transfer)).toBe("PAYMENT_METHOD_NOT_ACCEPTED");
  });

  it("answers PRICE_CHANGED and keeps the order idempotent by clientOrderId", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const stable = payload(product.id);

    const changed = await owner.client.post("/api/orders", { ...stable, expectedTotalCents: 1 });
    expect(changed.status).toBe(409);
    expect(await errorCode(changed)).toBe("PRICE_CHANGED");

    const first = await owner.client.post("/api/orders", stable);
    expect(first.status).toBe(201);
    const firstOrder = (await first.json()) as { number: number; totalCents: number };
    expect(firstOrder.totalCents).toBe(900_000);

    const replay = await owner.client.post("/api/orders", stable);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { number: number }).number).toBe(firstOrder.number);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM orders WHERE restaurant_id = ?")
      .bind(owner.restaurantId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("requires the phone for WhatsApp and keeps Local without one", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);

    const missingPhone = await owner.client.post(
      "/api/orders",
      payload(product.id, { customer: { name: "Juan" } }),
    );
    expect(missingPhone.status).toBe(422);

    const local = await owner.client.post(
      "/api/orders",
      payload(product.id, { source: "local", customer: { name: "Mostrador" } }),
    );
    expect(local.status).toBe(201);
  });

  it("marks a new order paid: with cash open it enters, without cash it stays charged outside", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);

    const withoutCash = await owner.client.post("/api/orders", payload(product.id, { markPaid: true }));
    expect(withoutCash.status).toBe(201);
    expect(await withoutCash.json()).toMatchObject({ paymentStatus: "paid", cashSessionId: null });

    const session = await owner.client.post("/api/cash-sessions", { openingCashCents: 0 });
    expect(session.status).toBe(201);
    const sessionId = ((await session.json()) as { id: string }).id;

    const withCash = await owner.client.post(
      "/api/orders",
      payload(product.id, { markPaid: true, clientOrderId: crypto.randomUUID() }),
    );
    expect(withCash.status).toBe(201);
    expect(await withCash.json()).toMatchObject({ paymentStatus: "paid", cashSessionId: sessionId });
  });

  it("marks a split order paid as two cash incomes and a delivery cash order as to settle", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const settings = await owner.client.patch("/api/restaurants/me/settings", {
      paymentMethods: [
        { method: "cash", enabled: true },
        { method: "transfer", enabled: true, alias: "marta.burgers", holderName: "Marta Gómez" },
        { method: "split", enabled: true },
      ],
    });
    expect(settings.status).toBe(200);
    const session = await owner.client.post("/api/cash-sessions", { openingCashCents: 0 });
    const sessionId = ((await session.json()) as { id: string }).id;

    const split = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        paymentMethod: "split",
        splitCashCents: 400_000,
        markPaid: true,
      }),
    );
    expect(split.status).toBe(201);
    const splitOrder = (await split.json()) as { id: string; paymentStatus: string; cashSessionId: string };
    expect(splitOrder).toMatchObject({ paymentStatus: "paid", cashSessionId: sessionId });

    const incomes = await env.DB.prepare(
      "SELECT method, amount_cents FROM cash_movements WHERE order_id = ? ORDER BY method",
    )
      .bind(splitOrder.id)
      .all<{ method: string; amount_cents: number }>();
    expect(incomes.results).toEqual([
      { method: "cash", amount_cents: 400_000 },
      { method: "transfer", amount_cents: 500_000 },
    ]);

    // Delivery cash marked paid stays "to settle": the courier still has to bring it to the drawer.
    const deliveryCash = await owner.client.post(
      "/api/orders",
      payload(product.id, {
        fulfillment: "delivery",
        customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
        markPaid: true,
        clientOrderId: crypto.randomUUID(),
      }),
    );
    expect(deliveryCash.status).toBe(201);
    expect(await deliveryCash.json()).toMatchObject({ paymentStatus: "paid", cashSessionId: null });
  });

  it("needs orders.create", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const staff = await staffClient({ permissions: ["orders.view"], owner });

    const res = await staff.client.post("/api/orders", payload(product.id));
    expect(res.status).toBe(403);

    const quote = await staff.client.post("/api/orders/delivery-quote", { lat: 0, lng: 0, subtotalCents: 1 });
    expect(quote.status).toBe(403);
  });

  it("does not accept a product of another store", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const foreign = await createCatalog(other);

    const res = await owner.client.post("/api/orders", payload(foreign.id));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("PRODUCT_UNAVAILABLE");
  });

  it("leaves web orders with source web", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const publicRes = await owner.client.post(`/api/public/menus/${owner.slug}/orders`, {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: crypto.randomUUID(),
      expectedTotalCents: 900_000,
    });
    expect(publicRes.status).toBe(201);

    const list = await owner.client.get("/api/orders?limit=1");
    const orders = ((await list.json()) as { orders: Array<{ source: string }> }).orders;
    expect(orders[0]?.source).toBe("web");
  });
});
