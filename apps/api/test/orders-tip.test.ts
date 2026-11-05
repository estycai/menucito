import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Category, Product } from "@menucito/shared";
import { Client, ownerWithRestaurant } from "./helpers";

let counter = 0;
const sampleUuid = () => "10000000-0000-4000-8000-" + String(counter++).padStart(12, "0");

async function createCategory(client: Client, name: string): Promise<Category> {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(client: Client, categoryId: string, priceCents: number): Promise<Product> {
  const res = await client.post("/api/products", {
    categoryId,
    name: "Hamburguesa completa",
    description: "Carne, queso y huevo",
    priceCents,
    available: true,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Product;
}

/** A store with delivery, takeaway, a single product of `priceCents` and transfer enabled. */
async function storeWithProduct(priceCents: number) {
  const owner = await ownerWithRestaurant();
  const category = await createCategory(owner.client, "Burgers");
  const product = await createProduct(owner.client, category.id, priceCents);
  const settings = await owner.client.patch("/api/restaurants/me/settings", {
    paymentMethods: [
      { method: "cash", enabled: true },
      { method: "transfer", enabled: true, alias: "marta.burgers", holderName: "Marta Gomez" },
    ],
  });
  expect(settings.status).toBe(200);
  return { ...owner, productId: product.id };
}

const order = (
  slug: string,
  productId: string,
  overrides: Record<string, unknown>,
) =>
  new Client().post(`/api/public/menus/${slug}/orders`, {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan Perez", phone: "11 5555 1234", address: "Av. Corrientes 1234" },
    fulfillment: "delivery",
    paymentMethod: "transfer",
    clientOrderId: sampleUuid(),
    expectedTotalCents: 900_000,
    ...overrides,
  });

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

const orderRowByToken = (clientOrderId: string) =>
  env.DB.prepare("SELECT * FROM orders WHERE client_token = ?")
    .bind(clientOrderId)
    .first<Record<string, unknown>>();

const countOrders = async (restaurantId: string) =>
  (await env.DB.prepare("SELECT count(*) AS n FROM orders WHERE restaurant_id = ?")
    .bind(restaurantId)
    .first<{ n: number }>())!.n;

describe("13 scenarios 8-13: tip in the public creation", () => {
  it("stores the tip and adds it to the total (scenario 8)", async () => {
    const { slug, productId } = await storeWithProduct(900_000);
    const clientOrderId = sampleUuid();

    const res = await order(slug, productId, {
      clientOrderId,
      tipCents: 123_500,
      expectedTotalCents: 1_023_500,
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: Record<string, unknown> };
    expect(data.order.tipCents).toBe(123_500);
    expect(data.order.subtotalCents).toBe(900_000);
    expect(data.order.totalCents).toBe(1_023_500);

    const row = await orderRowByToken(clientOrderId);
    expect(row?.tip_cents).toBe(123_500);
    expect(row?.total_cents).toBe(1_023_500);
  });

  it("rejects an expected total that does not include the tip, saving nothing (scenario 9)", async () => {
    const { restaurantId, slug, productId } = await storeWithProduct(900_000);
    const clientOrderId = sampleUuid();

    const res = await order(slug, productId, {
      clientOrderId,
      tipCents: 123_500,
      expectedTotalCents: 900_000, // Without the tip
    });

    expect(res.status).toBe(409);
    // The spec names the code TOTAL_MISMATCH; the API keeps the existing PRICE_CHANGED (see Desvíos).
    expect(await errorCode(res)).toBe("PRICE_CHANGED");
    expect(await countOrders(restaurantId)).toBe(0);
  });

  it("rejects a tip on cash or takeaway orders with 422, saving nothing (scenario 10)", async () => {
    const { restaurantId, slug, productId } = await storeWithProduct(900_000);

    const onCash = await order(slug, productId, { paymentMethod: "cash", tipCents: 80_000 });
    expect(onCash.status).toBe(422);
    expect(await errorCode(onCash)).toBe("VALIDATION_ERROR");

    const onTakeaway = await order(slug, productId, {
      fulfillment: "takeaway",
      customer: { name: "Juan Perez", phone: "11 5555 1234", address: null },
      tipCents: 80_000,
      expectedTotalCents: 900_000,
    });
    expect(onTakeaway.status).toBe(422);
    expect(await errorCode(onTakeaway)).toBe("VALIDATION_ERROR");

    expect(await countOrders(restaurantId)).toBe(0);
  });

  it.each([
    ["negative", -100],
    ["decimal", 80_000.5],
    ["not a multiple of 100", 80_150],
    ["above the cap", 5_000_100],
  ])("rejects an invalid tip: %s (scenario 11)", async (_label, tipCents) => {
    const { restaurantId, slug, productId } = await storeWithProduct(900_000);

    const res = await order(slug, productId, { tipCents, expectedTotalCents: 980_000 });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    expect(await countOrders(restaurantId)).toBe(0);
  });

  it("stores 0 and works as before when no tip is sent (scenario 12)", async () => {
    const { slug, productId } = await storeWithProduct(500_000);
    const clientOrderId = sampleUuid();

    const res = await order(slug, productId, {
      clientOrderId,
      paymentMethod: "cash",
      expectedTotalCents: 500_000,
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: Record<string, unknown> };
    expect(data.order.tipCents).toBe(0);
    expect(data.order.totalCents).toBe(500_000);
    expect((await orderRowByToken(clientOrderId))?.tip_cents).toBe(0);
  });

  it("includes the tip in the response and the WhatsApp message (scenario 13)", async () => {
    const { slug, productId } = await storeWithProduct(1_000_000);

    const res = await order(slug, productId, {
      tipCents: 80_000,
      expectedTotalCents: 1_080_000,
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: Record<string, unknown>; whatsappUrl: string };
    expect(data.order.tipCents).toBe(80_000);

    expect(data.whatsappUrl).toContain(encodeURIComponent("Propina para el repartidor: $800"));
    expect(data.whatsappUrl).toContain(encodeURIComponent("Total: $10.800"));
  });
});
