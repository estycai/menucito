import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { OrderDetail } from "@menucito/shared";
import { Client, errorCode, ownerWithRestaurant } from "./helpers";

let counter = 0;
const sampleUuid = () => "30000000-0000-4000-8000-" + String(counter++).padStart(12, "0");

/** A store with a single product of `priceCents`, delivery and split enabled. */
async function storeWithSplit(priceCents = 1_000_000) {
  const owner = await ownerWithRestaurant();
  const cat = await owner.client.post("/api/categories", { name: "Burgers" });
  const category = (await cat.json()) as { id: string };
  const prod = await owner.client.post("/api/products", {
    categoryId: category.id,
    name: "Hamburguesa",
    priceCents,
  });
  const product = (await prod.json()) as { id: string };
  const settings = await owner.client.patch("/api/restaurants/me/settings", {
    paymentMethods: [
      { method: "cash", enabled: true },
      { method: "transfer", enabled: true, alias: "marta.burgers", holderName: "Marta Gomez" },
      { method: "split", enabled: true },
    ],
  });
  expect(settings.status).toBe(200);
  return { ...owner, productId: product.id };
}

const order = (slug: string, productId: string, overrides: Record<string, unknown> = {}) =>
  new Client().post(`/api/public/menus/${slug}/orders`, {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan Perez", phone: "11 5555 1234", address: "Av. Corrientes 1234" },
    fulfillment: "delivery",
    paymentMethod: "split",
    splitCashCents: 400_000,
    cashTenderedCents: 500_000,
    clientOrderId: sampleUuid(),
    expectedTotalCents: 1_000_000,
    ...overrides,
  });

async function orderIdOf(restaurantId: string, number: number): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM orders WHERE restaurant_id = ? AND number = ?")
    .bind(restaurantId, number)
    .first<{ id: string }>();
  return row!.id;
}

const orderRowByToken = (clientOrderId: string) =>
  env.DB.prepare("SELECT * FROM orders WHERE client_token = ?")
    .bind(clientOrderId)
    .first<Record<string, unknown>>();

describe("14a: public orders with split payment", () => {
  it("creates a split order with its cash part and tendered amount", async () => {
    const { slug, restaurantId, productId } = await storeWithSplit();
    const clientOrderId = sampleUuid();

    const res = await order(slug, productId, { clientOrderId });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      order: Record<string, unknown> & { paymentBreakdown: Record<string, unknown> };
      whatsappUrl: string;
    };
    expect(data.order.paymentMethod).toBe("split");
    expect(data.order.splitCashCents).toBe(400_000);
    expect(data.order.cashTenderedCents).toBe(500_000);
    expect(data.order.paymentBreakdown).toEqual({
      cashCents: 400_000,
      transferCents: 600_000,
      tenderedCents: 500_000,
      changeCents: 100_000,
    });
    expect(data.whatsappUrl).toContain(encodeURIComponent("Dividir pago"));
    expect(data.whatsappUrl).toContain(encodeURIComponent("vuelto $1.000"));

    const row = await orderRowByToken(clientOrderId);
    expect(row?.split_cash_cents).toBe(400_000);
    expect(row?.cash_tendered_cents).toBe(500_000);
    expect(await orderIdOf(restaurantId, data.order.number as number)).toBeTruthy();
  });

  it("accepts a tip on a split delivery", async () => {
    const { slug, productId } = await storeWithSplit();
    const res = await order(slug, productId, {
      splitCashCents: 400_000,
      cashTenderedCents: 400_000,
      tipCents: 80_000,
      expectedTotalCents: 1_080_000,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: { tipCents: number } };
    expect(data.order.tipCents).toBe(80_000);
  });

  it("keeps the tip in the transfer part: the cash must stay below the total without the tip", async () => {
    const { slug, productId } = await storeWithSplit();
    // Total $10.800 with a $800 tip: $10.500 in cash would leave $300 by transfer, less than the tip.
    const coversTip = await order(slug, productId, {
      splitCashCents: 1_050_000,
      cashTenderedCents: undefined,
      tipCents: 80_000,
      expectedTotalCents: 1_080_000,
    });
    expect(coversTip.status).toBe(422);
    expect(await errorCode(coversTip)).toBe("VALIDATION_ERROR");

    const leavesTip = await order(slug, productId, {
      splitCashCents: 999_900,
      cashTenderedCents: undefined,
      tipCents: 80_000,
      expectedTotalCents: 1_080_000,
    });
    expect(leavesTip.status).toBe(201);
    const data = (await leavesTip.json()) as { order: { paymentBreakdown: { transferCents: number } } };
    expect(data.order.paymentBreakdown.transferCents).toBe(80_100);
  });

  it("rejects an invalid split and a store without split, saving nothing", async () => {
    const { slug, restaurantId, productId } = await storeWithSplit();
    const noCash = await order(slug, productId, { splitCashCents: 0 });
    expect(noCash.status).toBe(422);
    expect(await errorCode(noCash)).toBe("VALIDATION_ERROR");

    const allCash = await order(slug, productId, { splitCashCents: 1_000_000 });
    expect(allCash.status).toBe(422);

    const lowTendered = await order(slug, productId, { cashTenderedCents: 300_000 });
    expect(lowTendered.status).toBe(422);

    const disabled = await storeWithSplit();
    await disabled.client.patch("/api/restaurants/me/settings", {
      paymentMethods: [{ method: "split", enabled: false }],
    });
    const notAllowed = await order(disabled.slug, disabled.productId);
    expect(notAllowed.status).toBe(422);
    expect(await errorCode(notAllowed)).toBe("VALIDATION_ERROR");

    const count = await env.DB.prepare("SELECT count(*) AS n FROM orders WHERE restaurant_id = ?")
      .bind(restaurantId)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("filters by split and exports its parts in the CSV", async () => {
    const { client, slug, productId } = await storeWithSplit();
    await order(slug, productId);

    const list = await client.get("/api/orders?paymentMethod=split");
    expect(list.status).toBe(200);
    const data = (await list.json()) as { orders: Array<{ paymentMethod: string }> };
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]?.paymentMethod).toBe("split");

    const csv = await (await client.get("/api/orders/export?paymentMethod=split")).text();
    expect(csv).toContain("Efectivo;Transferencia;Abona con;Vuelto");
    expect(csv).toContain(";4000,00;6000,00;5000,00;1000,00;");
  });
});

describe("14a: PATCH /api/orders/:id/payment-method", () => {
  it("changes split to cash, removes the tip and recalculates the total", async () => {
    const { client, restaurantId, slug, productId } = await storeWithSplit();
    const created = await order(slug, productId, {
      tipCents: 80_000,
      expectedTotalCents: 1_080_000,
      cashTenderedCents: 400_000,
    });
    const createdBody = (await created.json()) as { order: { number: number } };
    const id = await orderIdOf(restaurantId, createdBody.order.number);

    const res = await client.patch(`/api/orders/${id}/payment-method`, {
      paymentMethod: "cash",
      cashTenderedCents: 1_200_000,
      expectedStatus: "new",
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as OrderDetail;
    expect(updated.paymentMethod).toBe("cash");
    expect(updated.tipCents).toBe(0);
    expect(updated.totalCents).toBe(1_000_000);
    expect(updated.splitCashCents).toBeNull();
    expect(updated.paymentBreakdown).toEqual({
      cashCents: 1_000_000,
      transferCents: 0,
      tenderedCents: 1_200_000,
      changeCents: 200_000,
    });
  });

  it("rejects a paid order with PAYMENT_LOCKED and a cancelled one with 409", async () => {
    const { client, restaurantId, slug, productId } = await storeWithSplit();
    const first = await order(slug, productId);
    const firstBody = (await first.json()) as { order: { number: number } };
    const firstId = await orderIdOf(restaurantId, firstBody.order.number);
    await client.patch(`/api/orders/${firstId}/payment`, { paymentStatus: "paid" });

    const paid = await client.patch(`/api/orders/${firstId}/payment-method`, {
      paymentMethod: "cash",
      expectedStatus: "new",
    });
    expect(paid.status).toBe(409);
    expect(await errorCode(paid)).toBe("PAYMENT_LOCKED");

    const second = await order(slug, productId);
    const secondBody = (await second.json()) as { order: { number: number } };
    const secondId = await orderIdOf(restaurantId, secondBody.order.number);
    await client.patch(`/api/orders/${secondId}/status`, { status: "cancelled" });

    const cancelled = await client.patch(`/api/orders/${secondId}/payment-method`, {
      paymentMethod: "cash",
      expectedStatus: "cancelled",
    });
    expect(cancelled.status).toBe(409);
    expect(await errorCode(cancelled)).toBe("INVALID_TRANSITION");
  });

  it("validates the split against the order total and the expected status", async () => {
    const { client, restaurantId, slug, productId } = await storeWithSplit();
    const created = await order(slug, productId);
    const createdBody = (await created.json()) as { order: { number: number } };
    const id = await orderIdOf(restaurantId, createdBody.order.number);

    const invalid = await client.patch(`/api/orders/${id}/payment-method`, {
      paymentMethod: "split",
      splitCashCents: 1_000_000,
      expectedStatus: "new",
    });
    expect(invalid.status).toBe(422);

    const noStatus = await client.patch(`/api/orders/${id}/payment-method`, { paymentMethod: "transfer" });
    expect(noStatus.status).toBe(422);
    expect(await errorCode(noStatus)).toBe("VALIDATION_ERROR");

    const stale = await client.patch(`/api/orders/${id}/payment-method`, {
      paymentMethod: "transfer",
      expectedStatus: "preparing",
    });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe("CONCURRENT_MODIFICATION");
  });

  it("rejects a split with a tip whose cash part would cover the tip", async () => {
    const { client, restaurantId, slug, productId } = await storeWithSplit();
    const created = await order(slug, productId, { tipCents: 80_000, expectedTotalCents: 1_080_000 });
    const createdBody = (await created.json()) as { order: { number: number } };
    const id = await orderIdOf(restaurantId, createdBody.order.number);

    const res = await client.patch(`/api/orders/${id}/payment-method`, {
      paymentMethod: "split",
      splitCashCents: 1_050_000,
      expectedStatus: "new",
    });
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("VALIDATION_ERROR");
  });

  it("delivering a split order marks it paid, and a delivered unpaid order cannot change its method", async () => {
    const { client, restaurantId, slug, productId } = await storeWithSplit();
    const split = await order(slug, productId);
    const splitId = await orderIdOf(restaurantId, ((await split.json()) as { order: { number: number } }).order.number);
    const deliveredSplit = await client.patch(`/api/orders/${splitId}/status`, {
      status: "delivered",
      expectedStatus: "new",
    });
    expect(deliveredSplit.status).toBe(200);
    expect(((await deliveredSplit.json()) as OrderDetail).paymentStatus).toBe("paid");

    const transfer = await order(slug, productId, {
      paymentMethod: "transfer",
      splitCashCents: undefined,
      cashTenderedCents: undefined,
    });
    const transferId = await orderIdOf(
      restaurantId,
      ((await transfer.json()) as { order: { number: number } }).order.number,
    );
    const delivered = await client.patch(`/api/orders/${transferId}/status`, {
      status: "delivered",
      expectedStatus: "new",
    });
    expect(((await delivered.json()) as OrderDetail).paymentStatus).toBe("pending");

    const res = await client.patch(`/api/orders/${transferId}/payment-method`, {
      paymentMethod: "cash",
      expectedStatus: "delivered",
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("INVALID_TRANSITION");
  });
});
