import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Category, Product, Restaurant } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;
const sampleUuid = () =>
  "20000000-0000-4000-8000-" + String(counter++).padStart(12, "0");

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function owner(name = "Marta") {
  const email = `owner${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", {
    name,
    email,
    password: "password-123",
    callbackURL: "/",
  });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  const res = await client.post("/api/restaurants", {
    name: `Lo de ${name}`,
    slug: `menu-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

async function createCategory(client: Client, name: string) {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(
  client: Client,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
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

async function createOrder(
  slug: string,
  productId: string,
  overrides: Record<string, unknown> = {},
) {
  const publicClient = new Client();
  const res = await publicClient.post(`/api/public/menus/${slug}/orders`, {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
    fulfillment: "delivery",
    paymentMethod: "cash",
    clientOrderId: sampleUuid(),
    expectedTotalCents: 900_000,
    ...overrides,
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { order: { number: number; totalCents: number } };
  // The public response carries no ids (scenario 14); the owner API needs the internal one.
  const row = await env.DB.prepare(
    "SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE r.slug = ? AND o.number = ?",
  )
    .bind(slug, data.order.number)
    .first<{ id: string }>();
  expect(row).not.toBeNull();
  return { ...data, order: { ...data.order, id: row!.id } };
}

describe("Owner Orders API (scenarios 31-38)", () => {
  it("lists orders for the session restaurant newest first with pagination (scenario 31)", async () => {
    // Without session -> 401
    const unauthRes = await new Client().get("/api/orders");
    expect(unauthRes.status).toBe(401);

    // Session without restaurant -> 404
    const noRestEmail = `norest${unique()}@example.com`;
    await new Client().post("/api/auth/sign-up/email", { name: "No Rest", email: noRestEmail, password: "password-123", callbackURL: "/" });
    const noRestOwner = new Client();
    await noRestOwner.open(sink.last().link);
    const noRestRes = await noRestOwner.get("/api/orders");
    expect(noRestRes.status).toBe(404);

    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);

    // Create 3 orders
    await createOrder(restaurant.slug, prod.id);
    await createOrder(restaurant.slug, prod.id);
    await createOrder(restaurant.slug, prod.id);

    // List default
    const res = await client.get("/api/orders");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { orders: Array<Record<string, unknown>>; nextBefore: number | null };
    expect(data.orders).toHaveLength(3);
    // Newest first (descending by number)
    expect(data.orders[0]!.number).toBe(3);
    expect(data.orders[1]!.number).toBe(2);
    expect(data.orders[2]!.number).toBe(1);
    expect(data.orders[0]!.itemCount).toBe(1);
    expect(data.orders[0]!.totalCents).toBe(900_000);
    expect(data.orders[0]!.customerName).toBe("Juan");
    expect(data.orders[0]!.customerPhone).toBe("5491155551234");
    expect(data.orders[0]!.deliveryLocation).toBeNull();
    expect(data.nextBefore).toBeNull();

    // Paginate with limit=2
    const resPage1 = await client.get("/api/orders?limit=2");
    const dataPage1 = (await resPage1.json()) as { orders: Array<{ number: number }>; nextBefore: number | null };
    expect(dataPage1.orders).toHaveLength(2);
    expect(dataPage1.orders[0]!.number).toBe(3);
    expect(dataPage1.orders[1]!.number).toBe(2);
    expect(dataPage1.nextBefore).toBe(2);

    // Next page with before=2
    const resPage2 = await client.get("/api/orders?limit=2&before=2");
    const dataPage2 = (await resPage2.json()) as { orders: Array<{ number: number }>; nextBefore: number | null };
    expect(dataPage2.orders).toHaveLength(1);
    expect(dataPage2.orders[0]!.number).toBe(1);
    expect(dataPage2.nextBefore).toBeNull();
  });

  it("filters orders by status, fulfillment, payment, and date range in America/Argentina/Buenos_Aires (scenario 32)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);

    // Enable transfer
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [
          { method: "cash", enabled: true },
          { method: "transfer", enabled: true, alias: "marta.pay", holderName: "Marta" },
        ],
      }),
    });

    const o1 = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery", paymentMethod: "cash" });
    const o2 = await createOrder(restaurant.slug, prod.id, { fulfillment: "takeaway", paymentMethod: "transfer" });

    // Transition o1 to preparing, o2 to delivered
    await client.request(`/api/orders/${o1.order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "preparing" }) });
    await client.request(`/api/orders/${o2.order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "delivered" }) });

    // Filter active: should include o1 (preparing) but not o2 (delivered)
    const resActive = await client.get("/api/orders?status=active");
    const dataActive = (await resActive.json()) as { orders: Array<{ id: string }> };
    expect(dataActive.orders).toHaveLength(1);
    expect(dataActive.orders[0]!.id).toBe(o1.order.id);

    // Filter fulfillment takeaway
    const resTak = await client.get("/api/orders?fulfillment=takeaway");
    const dataTak = (await resTak.json()) as { orders: Array<{ id: string }> };
    expect(dataTak.orders).toHaveLength(1);
    expect(dataTak.orders[0]!.id).toBe(o2.order.id);

    // Filter paymentMethod transfer
    const resTransfer = await client.get("/api/orders?paymentMethod=transfer");
    const dataTransfer = (await resTransfer.json()) as { orders: Array<{ id: string }> };
    expect(dataTransfer.orders).toHaveLength(1);
    expect(dataTransfer.orders[0]!.id).toBe(o2.order.id);

    // Invalid filter values respond 422
    expect((await client.get("/api/orders?status=invalid_status")).status).toBe(422);
    expect((await client.get("/api/orders?fulfillment=drone")).status).toBe(422);
    expect((await client.get("/api/orders?paymentMethod=bitcoin")).status).toBe(422);
    expect((await client.get("/api/orders?from=not-a-date")).status).toBe(422);
    expect((await client.get("/api/orders?from=2026-12-01&to=2026-11-01")).status).toBe(422);
    // from one day after to, and dates that do not exist on the calendar
    expect((await client.get("/api/orders?from=2026-11-03&to=2026-11-02")).status).toBe(422);
    expect((await client.get("/api/orders?from=2026-02-31")).status).toBe(422);
    expect((await client.get("/api/orders?to=2026-13-01")).status).toBe(422);
    expect((await client.get("/api/orders/export?from=2026-02-30")).status).toBe(422);

    // Date filtering: an order at 23:30 local (02:30 UTC next day) belongs to local day
    // 2026-11-02 23:30 in Buenos Aires = 2026-11-03 02:30:00 UTC
    const dateNov2LateUtc = new Date("2026-11-03T02:30:00Z").getTime();
    await env.DB.prepare("UPDATE orders SET created_at = ? WHERE id = ?").bind(dateNov2LateUtc, o1.order.id).run();

    // Query for from=2026-11-02&to=2026-11-02: should find o1
    const resNov2 = await client.get("/api/orders?from=2026-11-02&to=2026-11-02");
    const dataNov2 = (await resNov2.json()) as { orders: Array<{ id: string }> };
    expect(dataNov2.orders.some((o) => o.id === o1.order.id)).toBe(true);

    // Query for from=2026-11-03&to=2026-11-03: should NOT find o1
    const resNov3 = await client.get("/api/orders?from=2026-11-03&to=2026-11-03");
    const dataNov3 = (await resNov3.json()) as { orders: Array<{ id: string }> };
    expect(dataNov3.orders.some((o) => o.id === o1.order.id)).toBe(false);
  });

  it("retrieves order detail with items, options, totals and address (scenario 33)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    const created = await createOrder(restaurant.slug, prod.id, {
      customer: { name: "Juan", phone: "11 5555 1234", address: "Av. Libertador 500" },
    });

    const res = await client.get(`/api/orders/${created.order.id}`);
    expect(res.status).toBe(200);
    const order = (await res.json()) as Record<string, unknown>;
    expect(order.id).toBe(created.order.id);
    expect(order.customerName).toBe("Juan");
    expect(order.customerPhone).toBe("5491155551234");
    expect(order.deliveryAddress).toBe("Av. Libertador 500");
    expect(order.subtotalCents).toBe(900_000);
    expect(order.shippingCents).toBe(0);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(900_000);

    const items = order.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Hamburguesa completa");
    expect(items[0]!.position).toBe(0);

    // Unknown id -> 404 ORDER_NOT_FOUND
    const resMissing = await client.get("/api/orders/non-existent-order-id");
    expect(resMissing.status).toBe(404);
    expect(((await resMissing.json()) as { error: { code: string } }).error.code).toBe("ORDER_NOT_FOUND");
  });

  it("applies status transitions with optimistic check and handles no-ops and invalid transitions (scenario 34)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);
    const created = await createOrder(restaurant.slug, prod.id);

    // 1. new -> preparing is valid (200)
    const res1 = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "preparing" }),
    });
    expect(res1.status).toBe(200);
    expect(((await res1.json()) as { status: string }).status).toBe("preparing");

    // 2. Repeating current status is a no-op (200)
    const resNoop = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "preparing" }),
    });
    expect(resNoop.status).toBe(200);

    // 3. Backward transition (preparing -> new) is rejected with 409 INVALID_TRANSITION
    const resBack = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "new" }),
    });
    expect(resBack.status).toBe(409);
    expect(((await resBack.json()) as { error: { code: string } }).error.code).toBe("INVALID_TRANSITION");

    // 4. Skip forward to delivered (preparing -> delivered) is valid
    const resDelivered = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "delivered" }),
    });
    expect(resDelivered.status).toBe(200);

    // 5. Transition from delivered is rejected
    const resFromDelivered = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });
    expect(resFromDelivered.status).toBe(409);

    // 6. Unknown status -> 422
    const resUnknown = await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "flying" }),
    });
    expect(resUnknown.status).toBe(422);

    // 7. Unknown order id -> 404
    const res404 = await client.request("/api/orders/unknown-id/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "ready" }),
    });
    expect(res404.status).toBe(404);
  });

  it("never lets two simultaneous status changes trample each other (scenario 34)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);
    const created = await createOrder(restaurant.slug, prod.id);

    const patch = (status: string) =>
      client.request(`/api/orders/${created.order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    const [toPreparing, toReady] = await Promise.all([patch("preparing"), patch("ready")]);

    const final = (await env.DB.prepare("SELECT status FROM orders WHERE id = ?")
      .bind(created.order.id)
      .first<{ status: string }>())!.status;

    const results = [
      { target: "preparing", status: toPreparing.status },
      { target: "ready", status: toReady.status },
    ];
    for (const result of results) expect([200, 409]).toContain(result.status);
    const winners = results.filter((r) => r.status === 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);

    if (winners.length === 1) {
      // Both read `new`: the conditional update lets exactly one apply, the other gets 409.
      expect(final).toBe(winners[0]!.target);
    } else {
      // They ran one after the other: only preparing -> ready is a valid second step, never ready -> preparing.
      expect(final).toBe("ready");
    }
  });

  it("updates payment status independently in both directions on any order status (scenario 35)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);
    const created = await createOrder(restaurant.slug, prod.id);

    // Mark as paid
    const resPaid = await client.request(`/api/orders/${created.order.id}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus: "paid" }),
    });
    expect(resPaid.status).toBe(200);
    expect(((await resPaid.json()) as { paymentStatus: string }).paymentStatus).toBe("paid");

    // Cancel order
    await client.request(`/api/orders/${created.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });

    // Revert payment status back to pending on cancelled order
    const resPending = await client.request(`/api/orders/${created.order.id}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus: "pending" }),
    });
    expect(resPending.status).toBe(200);
    const dataPending = (await resPending.json()) as { paymentStatus: string; status: string };
    expect(dataPending.paymentStatus).toBe("pending");
    expect(dataPending.status).toBe("cancelled");

    // Invalid payment status -> 422
    const resInvalid = await client.request(`/api/orders/${created.order.id}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus: "crypto" }),
    });
    expect(resInvalid.status).toBe(422);
  });

  it("enforces tenant isolation across all operations between two owners A and B (scenario 36)", async () => {
    const ownerA = await owner("Owner A");
    const catA = await createCategory(ownerA.client, "Burgers A");
    const prodA = await createProduct(ownerA.client, catA.id);
    const orderA = await createOrder(ownerA.restaurant.slug, prodA.id, {
      customer: { name: "Cliente Exclusivo A", phone: "11 5555 1111", address: "Calle A" },
    });

    const ownerB = await owner("Owner B");
    const catB = await createCategory(ownerB.client, "Burgers B");
    const prodB = await createProduct(ownerB.client, catB.id);
    const orderB = await createOrder(ownerB.restaurant.slug, prodB.id, {
      customer: { name: "Cliente Exclusivo B", phone: "11 5555 2222", address: "Calle B" },
    });

    // 1. List: B does not see A's order
    const resListB = await ownerB.client.get("/api/orders");
    const dataListB = (await resListB.json()) as { orders: Array<{ id: string }> };
    expect(dataListB.orders.some((o) => o.id === orderA.order.id)).toBe(false);
    expect(dataListB.orders.some((o) => o.id === orderB.order.id)).toBe(true);

    // 2. Detail: B gets 404 when requesting A's order
    const resDetailB = await ownerB.client.get(`/api/orders/${orderA.order.id}`);
    expect(resDetailB.status).toBe(404);

    // 3. Status change: B gets 404 when trying to update A's order, and A's order is unchanged
    const resStatusB = await ownerB.client.request(`/api/orders/${orderA.order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "delivered" }),
    });
    expect(resStatusB.status).toBe(404);
    const checkA = await ownerA.client.get(`/api/orders/${orderA.order.id}`);
    expect(((await checkA.json()) as { status: string }).status).toBe("new");

    // 4. Payment change: B gets 404 when trying to update A's payment status
    const resPaymentB = await ownerB.client.request(`/api/orders/${orderA.order.id}/payment`, {
      method: "PATCH",
      body: JSON.stringify({ paymentStatus: "paid" }),
    });
    expect(resPaymentB.status).toBe(404);
    const checkAPayment = await ownerA.client.get(`/api/orders/${orderA.order.id}`);
    expect(((await checkAPayment.json()) as { paymentStatus: string }).paymentStatus).toBe("pending");

    // 5. Export: B's CSV export does not contain A's order
    const resExportB = await ownerB.client.get("/api/orders/export");
    expect(resExportB.status).toBe(200);
    const csvB = await resExportB.text();
    expect(csvB).toContain("Cliente Exclusivo B");
    expect(csvB).not.toContain("Cliente Exclusivo A");
  });

  it("exports CSV with BOM, semicolon separator, escaped formulas and headers (scenario 37)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    // Create order with formula-like customer name
    await createOrder(restaurant.slug, prod.id, {
      customer: { name: "=SUM(1,2)", phone: "11 5555 1234", address: "Av. Corrientes 100" },
    });

    const res = await client.get("/api/orders/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="pedidos-\d{4}-\d{2}-\d{2}\.csv"$/);

    // Verify raw bytes contain UTF-8 BOM: 0xEF, 0xBB, 0xBF
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const csvText = new TextDecoder().decode(bytes);
    // Semicolon separated header
    expect(csvText).toContain("Número;Fecha y hora;Estado;Estado de pago;Modalidad;Forma de pago;Cliente;Teléfono;Dirección;Repartidor;Subtotal;Envío;Propina;Total;Ítems");

    // Customer name with = escaped with apostrophe
    expect(csvText).toContain("'=SUM(1,2)");

    // Prices formatted in ARS with comma decimal: 9000,00
    expect(csvText).toContain("9000,00");
  });

  it("preserves catalog operations: categories and products can be deleted/reordered without regression (scenario 38)", async () => {
    const { client, restaurant } = await owner();
    const cat1 = await createCategory(client, "Cat 1");
    const cat2 = await createCategory(client, "Cat 2");
    const prod1 = await createProduct(client, cat1.id, { name: "Prod 1" });
    const prod2 = await createProduct(client, cat1.id, { name: "Prod 2" });

    // Order created for prod1
    await createOrder(restaurant.slug, prod1.id);

    // Deleting prod1 works (product_id in order_items will be set to NULL)
    const delRes = await client.request(`/api/products/${prod1.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // Reordering remaining products works
    const reorderProd = await client.request(`/api/categories/${cat1.id}/products/order`, {
      method: "PUT",
      body: JSON.stringify({ ids: [prod2.id] }),
    });
    expect(reorderProd.status).toBe(204);

    // Reordering categories works
    const reorderCat = await client.request("/api/categories/order", {
      method: "PUT",
      body: JSON.stringify({ ids: [cat2.id, cat1.id] }),
    });
    expect(reorderCat.status).toBe(204);

    // Public menu still works
    const publicClient = new Client();
    const menuRes = await publicClient.get(`/api/public/menus/${restaurant.slug}`);
    expect(menuRes.status).toBe(200);
  });
});

describe("Sent status (spec 11b, scenarios 10-12)", () => {
  async function ownerWithProduct() {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id);
    const patchStatus = (orderId: string, status: string) =>
      client.request(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    return { client, restaurant, prod, patchStatus };
  }

  it("requires a courier to send a delivery order and rejects sending a takeaway one with 409 (scenario 10, decision 6)", async () => {
    const { restaurant, prod, patchStatus } = await ownerWithProduct();
    const delivery = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery" });
    const takeaway = await createOrder(restaurant.slug, prod.id, { fulfillment: "takeaway" });

    // Since spec 13, `sent` is reached only by assigning a courier.
    const resSent = await patchStatus(delivery.order.id, "sent");
    expect(resSent.status).toBe(409);
    expect(((await resSent.json()) as { error: { code: string } }).error.code).toBe("COURIER_REQUIRED");

    const resTakeaway = await patchStatus(takeaway.order.id, "sent");
    expect(resTakeaway.status).toBe(409);
    expect(((await resTakeaway.json()) as { error: { code: string } }).error.code).toBe("INVALID_TRANSITION");

    // The delivery order still walks its pipeline and never goes back.
    expect((await patchStatus(delivery.order.id, "ready")).status).toBe(200);
    expect((await patchStatus(delivery.order.id, "new")).status).toBe(409);
    expect((await patchStatus(delivery.order.id, "delivered")).status).toBe(200);
  });

  it("cancels a sent order (scenario 10, decision 2)", async () => {
    const { restaurant, prod, patchStatus } = await ownerWithProduct();
    const created = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery" });
    // A sent order (older ones have no courier) still cancels from Pedidos.
    await env.DB.prepare("UPDATE orders SET status = 'sent' WHERE id = ?").bind(created.order.id).run();

    const resCancel = await patchStatus(created.order.id, "cancelled");
    expect(resCancel.status).toBe(200);
    expect(((await resCancel.json()) as { status: string }).status).toBe("cancelled");
  });

  it("never lets two simultaneous changes from ready trample each other (scenario 34)", async () => {
    const { restaurant, prod, patchStatus } = await ownerWithProduct();
    const created = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery" });
    expect((await patchStatus(created.order.id, "ready")).status).toBe(200);

    const [toDelivered, toCancelled] = await Promise.all([
      patchStatus(created.order.id, "delivered"),
      patchStatus(created.order.id, "cancelled"),
    ]);
    const final = (await env.DB.prepare("SELECT status FROM orders WHERE id = ?")
      .bind(created.order.id)
      .first<{ status: string }>())!.status;

    const results = [
      { target: "delivered", status: toDelivered.status },
      { target: "cancelled", status: toCancelled.status },
    ];
    for (const result of results) expect([200, 409]).toContain(result.status);
    const winners = results.filter((r) => r.status === 200);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    if (winners.length === 1) {
      expect(final).toBe(winners[0]!.target);
    } else {
      // One after the other: only ready -> delivered -> cancelled would be valid, never cancelled -> delivered.
      expect(final).toBe("cancelled");
    }
  });

  it("filters delivered orders by when they were delivered with dateField=delivered (decision 4, scenario 43)", async () => {
    const { client, restaurant, prod, patchStatus } = await ownerWithProduct();
    const afterMidnight = await createOrder(restaurant.slug, prod.id);
    const fromYesterday = await createOrder(restaurant.slug, prod.id);
    expect((await patchStatus(afterMidnight.order.id, "delivered")).status).toBe(200);
    expect((await patchStatus(fromYesterday.order.id, "delivered")).status).toBe(200);

    // Local times in Buenos Aires (UTC-3).
    const at = (iso: string) => new Date(iso).getTime();
    const setDates = (id: string, createdIso: string, updatedIso: string, deliveredIso: string) =>
      env.DB.prepare("UPDATE orders SET created_at = ?, updated_at = ?, delivered_at = ? WHERE id = ?")
        .bind(at(createdIso), at(updatedIso), at(deliveredIso), id)
        .run();
    // Created 2026-11-02 23:30, delivered 2026-11-03 00:10.
    await setDates(afterMidnight.order.id, "2026-11-03T02:30:00Z", "2026-11-03T03:10:00Z", "2026-11-03T03:10:00Z");
    // Created 2026-11-02 13:00, delivered 2026-11-03 12:00.
    await setDates(fromYesterday.order.id, "2026-11-02T16:00:00Z", "2026-11-03T15:00:00Z", "2026-11-03T15:00:00Z");

    const idsOf = async (query: string) =>
      ((await (await client.get(`/api/orders?${query}`)).json()) as { orders: Array<{ id: string }> }).orders
        .map((o) => o.id)
        .sort();
    const both = [afterMidnight.order.id, fromYesterday.order.id].sort();

    expect(await idsOf("status=delivered&from=2026-11-03&to=2026-11-03&dateField=delivered")).toEqual(both);
    expect(await idsOf("status=delivered&from=2026-11-02&to=2026-11-02&dateField=delivered")).toEqual([]);
    // `updated` still sees them on the day of their last change.
    expect(await idsOf("status=delivered&from=2026-11-03&to=2026-11-03&dateField=updated")).toEqual(both);
    // The default keeps filtering on the creation date (history and CSV are unchanged).
    expect(await idsOf("status=delivered&from=2026-11-03&to=2026-11-03")).toEqual([]);
    expect(await idsOf("status=delivered&from=2026-11-02&to=2026-11-02")).toEqual(both);
  });

  it("filters by sent, includes sent in active and labels it Enviado in the CSV (scenario 11)", async () => {
    const { client, restaurant, prod, patchStatus } = await ownerWithProduct();
    const sent = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery" });
    const fresh = await createOrder(restaurant.slug, prod.id, { fulfillment: "delivery" });
    const delivered = await createOrder(restaurant.slug, prod.id, { fulfillment: "takeaway" });
    // A sent order of the older kind (no courier) is set directly.
    await env.DB.prepare("UPDATE orders SET status = 'sent' WHERE id = ?").bind(sent.order.id).run();
    expect((await patchStatus(delivered.order.id, "delivered")).status).toBe(200);

    const resSent = await client.get("/api/orders?status=sent");
    expect(resSent.status).toBe(200);
    const dataSent = (await resSent.json()) as { orders: Array<{ id: string; status: string }> };
    expect(dataSent.orders.map((o) => o.id)).toEqual([sent.order.id]);

    const resActive = await client.get("/api/orders?status=active");
    const dataActive = (await resActive.json()) as { orders: Array<{ id: string }> };
    expect(dataActive.orders.map((o) => o.id).sort()).toEqual([sent.order.id, fresh.order.id].sort());

    const csv = await (await client.get("/api/orders/export?status=sent")).text();
    expect(csv).toContain(`${sent.order.number};`);
    expect(csv).toContain(";Enviado;");
  });
});
