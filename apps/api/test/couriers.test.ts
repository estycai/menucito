import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Category, CourierOption, CourierSummary, DeliverySummary, OrderDetail, Product, Role } from "@menucito/shared";
import { Client, TEST_PASSWORD, createVerifiedAccount, errorCode, ownerWithRestaurant, signedInClient, staffClient, unique } from "./helpers";

let counter = 0;
const uuid = () => "30000000-0000-4000-8000-" + String(counter++).padStart(12, "0");
const nextPhone = () => `11 5555 ${String(1000 + counter++).slice(-4)}`;

const AMOUNT = 900_000;

/** A store with a single product of `AMOUNT` and both payment methods enabled. */
async function store(shippingCents = 0) {
  const owner = await ownerWithRestaurant();
  const category = (await (await owner.client.post("/api/categories", { name: "Burgers" })).json()) as Category;
  const product = (await (
    await owner.client.post("/api/products", { categoryId: category.id, name: "Burger", priceCents: AMOUNT, available: true })
  ).json()) as Product;
  const settings = await owner.client.patch("/api/restaurants/me/settings", {
    shippingCents,
    paymentMethods: [
      { method: "cash", enabled: true },
      { method: "transfer", enabled: true, alias: "marta.pay", holderName: "Marta" },
    ],
  });
  expect(settings.status).toBe(200);
  return { owner, productId: product.id, shippingCents };
}

interface OrderOptions {
  fulfillment?: "delivery" | "takeaway";
  paymentMethod?: "cash" | "transfer";
  tipCents?: number;
  shippingCents?: number;
}

/** A public order whose total matches what the store charges; returns its internal id. */
async function createOrder(slug: string, productId: string, options: OrderOptions = {}) {
  const fulfillment = options.fulfillment ?? "delivery";
  const paymentMethod = options.paymentMethod ?? "cash";
  const tipCents = options.tipCents ?? 0;
  const shipping = fulfillment === "delivery" ? options.shippingCents ?? 0 : 0;
  const clientOrderId = uuid();
  const res = await new Client().post(`/api/public/menus/${slug}/orders`, {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan", phone: nextPhone(), address: fulfillment === "delivery" ? "Calle 1" : null },
    fulfillment,
    paymentMethod,
    clientOrderId,
    tipCents,
    expectedTotalCents: AMOUNT + shipping + tipCents,
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { order: { number: number } };
  const row = await env.DB.prepare(
    "SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE r.slug = ? AND o.number = ?",
  )
    .bind(slug, data.order.number)
    .first<{ id: string }>();
  expect(row).not.toBeNull();
  return { id: row!.id, number: data.order.number };
}

/** Creates a member (and a session) through the owner's API. */
async function addMember(
  owner: Awaited<ReturnType<typeof ownerWithRestaurant>>,
  firstName: string,
  options: { isCourier?: boolean; permissions?: string[] } = {},
) {
  const role = (await (
    await owner.client.post("/api/roles", { name: `Rol ${unique()}`, permissions: options.permissions ?? [] })
  ).json()) as Role;
  const email = `member${unique()}@example.com`;
  const res = await owner.client.post("/api/members", {
    firstName,
    lastName: "Reparto",
    email,
    password: TEST_PASSWORD,
    roleId: role.id,
    isCourier: options.isCourier ?? false,
  });
  expect(res.status).toBe(201);
  const member = (await res.json()) as { id: string };
  const client = await signedInClient(email);
  return { client, memberId: member.id, email, roleId: role.id };
}

async function readyOrder(owner: Awaited<ReturnType<typeof ownerWithRestaurant>>, slug: string, productId: string, options: OrderOptions = {}) {
  const order = await createOrder(slug, productId, options);
  const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "ready" });
  expect(res.status).toBe(200);
  return order;
}

const orderRow = (id: string) =>
  env.DB.prepare("SELECT status, payment_status, courier_member_id, sent_at, delivered_at FROM orders WHERE id = ?")
    .bind(id)
    .first<{ status: string; payment_status: string; courier_member_id: string | null; sent_at: number | null; delivered_at: number | null }>();

describe("13 couriers: assignment and the courier picker (scenarios 14-20)", () => {
  it("lists only the active couriers of the local, by name and with their orders on the way; without the permission it is 403 (scenario 14)", async () => {
    const { owner, productId, shippingCents } = await store();
    const bruno = await addMember(owner, "bruno", { isCourier: true });
    const zoe = await addMember(owner, "Zoe", { isCourier: true });
    await addMember(owner, "Ana", { isCourier: false });
    const idle = await addMember(owner, "Carla", { isCourier: true });
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(idle.memberId).run();

    const picker = await staffClient({ owner, permissions: ["orders.view", "orders.assign"] });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });
    const assigned = await picker.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: bruno.memberId });
    expect(assigned.status).toBe(200);

    const res = await picker.client.get("/api/couriers");
    expect(res.status).toBe(200);
    const couriers = (await res.json()) as CourierOption[];
    expect(couriers.map((c) => `${c.firstName}`)).toEqual(["bruno", "Zoe"]);
    expect(couriers[0]).toMatchObject({ memberId: bruno.memberId, inProgressOrders: 1 });
    expect(couriers[1]).toMatchObject({ memberId: zoe.memberId, inProgressOrders: 0 });
    // A local without coordinates is irrelevant here; keep the type honest.
    expect(typeof couriers[0]!.lastName).toBe("string");

    const forbidden = await staffClient({ owner, permissions: ["orders.view"] });
    expect((await forbidden.client.get("/api/couriers")).status).toBe(403);
    expect(await errorCode(await forbidden.client.get("/api/couriers"))).toBe("FORBIDDEN");
  });

  it("assigns a courier to a ready delivery order, passing it to sent with sent_at (scenario 15)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });

    const res = await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrderDetail;
    expect(body.status).toBe("sent");
    expect(body.courier).toEqual({ memberId: courier.memberId, firstName: "Bruno", lastName: "Reparto" });
    expect(body.sentAt).toEqual(expect.any(Number));

    const row = await orderRow(order.id);
    expect(row).toMatchObject({ status: "sent", courier_member_id: courier.memberId });
    expect(row!.sent_at).not.toBeNull();
  });

  it("reassigns a sent order keeping sent_at and moving it between deliveries lists (scenario 16)", async () => {
    const { owner, productId, shippingCents } = await store();
    const first = await addMember(owner, "Ana", { isCourier: true });
    const second = await addMember(owner, "Beto", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });

    expect((await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: first.memberId })).status).toBe(200);
    const sentAt = (await orderRow(order.id))!.sent_at;

    const reassigned = await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: second.memberId });
    expect(reassigned.status).toBe(200);
    const body = (await reassigned.json()) as OrderDetail;
    expect(body.status).toBe("sent");
    expect(body.courier?.memberId).toBe(second.memberId);
    expect((await orderRow(order.id))!.sent_at).toBe(sentAt);

    const firstList = (await (await first.client.get("/api/deliveries")).json()) as Array<{ id: string }>;
    const secondList = (await (await second.client.get("/api/deliveries")).json()) as Array<{ id: string }>;
    expect(firstList.some((o) => o.id === order.id)).toBe(false);
    expect(secondList.some((o) => o.id === order.id)).toBe(true);

    // Anything but a ready/sent delivery order is an invalid transition.
    const takeaway = await readyOrder(owner, owner.slug, productId, { fulfillment: "takeaway" });
    const fresh = await createOrder(owner.slug, productId, { shippingCents });
    const preparing = await createOrder(owner.slug, productId, { shippingCents });
    await owner.client.patch(`/api/orders/${preparing.id}/status`, { status: "preparing" });
    const delivered = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.patch(`/api/orders/${delivered.id}/status`, { status: "delivered" });
    const cancelled = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.patch(`/api/orders/${cancelled.id}/status`, { status: "cancelled" });

    for (const id of [takeaway.id, fresh.id, preparing.id, delivered.id, cancelled.id]) {
      const res = await owner.client.post(`/api/orders/${id}/assign`, { courierMemberId: first.memberId });
      expect(res.status, id).toBe(409);
      expect(await errorCode(res), id).toBe("INVALID_TRANSITION");
    }
  });

  it("refuses an inactive, non-courier, unknown or foreign courier with 422, leaving the order untouched (scenario 17)", async () => {
    const { owner, productId, shippingCents } = await store();
    const other = await store();
    const inactive = await addMember(owner, "Inactivo", { isCourier: true });
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(inactive.memberId).run();
    const notCourier = await addMember(owner, "SinMarca", { isCourier: false });
    const foreign = await addMember(other.owner, "Ajeno", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });

    for (const courierMemberId of [inactive.memberId, notCourier.memberId, "no-such-member", foreign.memberId]) {
      const res = await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId });
      expect(res.status, courierMemberId).toBe(422);
      expect(await errorCode(res), courierMemberId).toBe("VALIDATION_ERROR");
    }
    expect((await orderRow(order.id))!.status).toBe("ready");
    expect((await orderRow(order.id))!.courier_member_id).toBeNull();
  });

  it("lets only one of two simultaneous assignments win (scenario 18)", async () => {
    const { owner, productId, shippingCents } = await store();
    const a = await addMember(owner, "Ana", { isCourier: true });
    const b = await addMember(owner, "Beto", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });

    const [ra, rb] = await Promise.all([
      owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: a.memberId }),
      owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: b.memberId }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(await errorCode(loser)).toBe("CONCURRENT_MODIFICATION");
    expect([a.memberId, b.memberId]).toContain((await orderRow(order.id))!.courier_member_id);
  });

  it("rejects PATCH status=sent with COURIER_REQUIRED (scenario 19)", async () => {
    const { owner, productId, shippingCents } = await store();
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });
    const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "sent" });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("COURIER_REQUIRED");
  });

  it("answers 404 when assigning an order of another local (scenario 20)", async () => {
    const a = await store();
    const b = await store();
    const courier = await addMember(b.owner, "Beto", { isCourier: true });
    const order = await readyOrder(a.owner, a.owner.slug, a.productId, { shippingCents: a.shippingCents });
    const res = await b.owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("ORDER_NOT_FOUND");
  });
});

describe("13 couriers: delivering from Pedidos (scenarios 21-24)", () => {
  it("stamps delivered_at and marks cash paid, leaving transfer alone (scenario 21)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const cash = await readyOrder(owner, owner.slug, productId, { shippingCents });
    const transfer = await readyOrder(owner, owner.slug, productId, { paymentMethod: "transfer", shippingCents });
    await owner.client.post(`/api/orders/${cash.id}/assign`, { courierMemberId: courier.memberId });
    await owner.client.post(`/api/orders/${transfer.id}/assign`, { courierMemberId: courier.memberId });

    const delivered = await owner.client.patch(`/api/orders/${cash.id}/status`, { status: "delivered" });
    expect(delivered.status).toBe(200);
    expect((await orderRow(cash.id))!.delivered_at).not.toBeNull();
    expect((await orderRow(cash.id))!.payment_status).toBe("paid");

    expect((await owner.client.patch(`/api/orders/${transfer.id}/status`, { status: "delivered" })).status).toBe(200);
    expect((await orderRow(transfer.id))!.delivered_at).not.toBeNull();
    expect((await orderRow(transfer.id))!.payment_status).toBe("pending");
  });

  it("delivers a sent order that has no courier, as the older ones (scenario 22)", async () => {
    const { owner, productId, shippingCents } = await store();
    const order = await createOrder(owner.slug, productId, { shippingCents });
    await env.DB.prepare("UPDATE orders SET status = 'sent', courier_member_id = NULL WHERE id = ?").bind(order.id).run();

    const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "delivered" });
    expect(res.status).toBe(200);
    expect((await orderRow(order.id))!.delivered_at).not.toBeNull();
  });

  it("stamps delivered_at for a takeaway order too (scenario 23)", async () => {
    const { owner, productId } = await store();
    const order = await createOrder(owner.slug, productId, { fulfillment: "takeaway" });
    const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "delivered" });
    expect(res.status).toBe(200);
    const row = await orderRow(order.id);
    expect(row!.delivered_at).not.toBeNull();
    expect(row!.payment_status).toBe("paid");
  });

  it("cancelling a sent order keeps the courier and leaves delivered_at null (scenario 24)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId });

    expect((await owner.client.patch(`/api/orders/${order.id}/status`, { status: "cancelled" })).status).toBe(200);
    const row = await orderRow(order.id);
    expect(row!.status).toBe("cancelled");
    expect(row!.courier_member_id).toBe(courier.memberId);
    expect(row!.delivered_at).toBeNull();
  });
});

describe("13 couriers: Mis repartos (scenarios 25-29)", () => {
  it("lists the courier's own sent orders, oldest first and with the delivery data (scenario 25)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const first = await readyOrder(owner, owner.slug, productId, { shippingCents });
    const second = await readyOrder(owner, owner.slug, productId, { paymentMethod: "transfer", tipCents: 80_000, shippingCents });
    await owner.client.post(`/api/orders/${first.id}/assign`, { courierMemberId: courier.memberId });
    await owner.client.post(`/api/orders/${second.id}/assign`, { courierMemberId: courier.memberId });

    const res = await courier.client.get("/api/deliveries");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    expect(list.map((o) => o.number)).toEqual([first.number, second.number]);
    expect(list[0]).toMatchObject({
      customerName: "Juan",
      paymentMethod: "cash",
      deliveryAddress: "Calle 1",
      totalCents: AMOUNT + shippingCents,
      shippingCents,
      tipCents: 0,
    });
    expect(list[1]).toMatchObject({ paymentMethod: "transfer", tipCents: 80_000 });
    expect(typeof list[0]!.customerPhone).toBe("string");
    expect(list[0]!.deliveryLocation).toBeNull();
  });

  it("delivers one of its own orders, stamping delivered_at and paying cash (scenario 26)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId });

    const res = await courier.client.post(`/api/deliveries/${order.id}/delivered`, {});
    expect(res.status).toBe(200);
    const row = await orderRow(order.id);
    expect(row!.status).toBe("delivered");
    expect(row!.delivered_at).not.toBeNull();
    expect(row!.payment_status).toBe("paid");
  });

  it("never shows or delivers a stranger's order: 404 unknown, 409 for one of its own that is not sent (scenario 27)", async () => {
    const { owner, productId, shippingCents } = await store();
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const stranger = await addMember(owner, "Otra", { isCourier: true });
    const own = await readyOrder(owner, owner.slug, productId, { shippingCents });
    const foreign = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${own.id}/assign`, { courierMemberId: courier.memberId });
    await owner.client.post(`/api/orders/${foreign.id}/assign`, { courierMemberId: stranger.memberId });

    const list = (await (await courier.client.get("/api/deliveries")).json()) as Array<{ id: string }>;
    expect(list.map((o) => o.id)).toEqual([own.id]);

    // Another courier's order and an unknown one are 404.
    expect((await courier.client.post(`/api/deliveries/${foreign.id}/delivered`, {})).status).toBe(404);
    expect((await courier.client.post("/api/deliveries/no-such-order/delivered", {})).status).toBe(404);

    // One of its own that is not sent anymore is a 409.
    await owner.client.patch(`/api/orders/${own.id}/status`, { status: "cancelled" });
    const conflict = await courier.client.post(`/api/deliveries/${own.id}/delivered`, {});
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("INVALID_TRANSITION");
  });

  it("closes the courier routes for a non-courier, an inactive member and a user without a restaurant (scenario 28)", async () => {
    const { owner } = await store();
    const notCourier = await staffClient({ owner, permissions: ["orders.view"] });
    expect((await notCourier.client.get("/api/deliveries")).status).toBe(403);
    expect(await errorCode(await notCourier.client.get("/api/deliveries"))).toBe("NOT_A_COURIER");

    const inactive = await staffClient({ owner, permissions: [], isCourier: true, active: false });
    expect((await inactive.client.get("/api/deliveries")).status).toBe(403);
    expect(await errorCode(await inactive.client.get("/api/deliveries"))).toBe("MEMBER_INACTIVE");

    const account = await createVerifiedAccount("Sin Local");
    const noRestaurant = await signedInClient(account.email);
    expect((await noRestaurant.get("/api/deliveries")).status).toBe(404);
    expect(await errorCode(await noRestaurant.get("/api/deliveries"))).toBe("RESTAURANT_NOT_FOUND");
  });

  it("summarizes the courier's own deliveries of a range, today by default (scenario 29)", async () => {
    const { owner, productId, shippingCents } = await store(50_000);
    const courier = await addMember(owner, "Bruno", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { paymentMethod: "transfer", tipCents: 80_000, shippingCents });
    await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId });
    await owner.client.patch(`/api/orders/${order.id}/status`, { status: "delivered" });

    const res = await courier.client.get("/api/deliveries/summary");
    expect(res.status).toBe(200);
    const summary = (await res.json()) as DeliverySummary;
    expect(summary.delivered).toBe(1);
    expect(summary.shippingCents).toBe(50_000);
    expect(summary.tipCents).toBe(80_000);
    expect(summary.from).toBe(summary.to);

    expect((await courier.client.get("/api/deliveries/summary?from=2026-11-03&to=2026-11-02")).status).toBe(422);
  });
});

describe("13 couriers: courier summary (scenarios 30-32)", () => {
  async function summaryStore() {
    const { owner, productId, shippingCents } = await store(50_000);
    const ana = await addMember(owner, "Ana", { isCourier: true });
    const beto = await addMember(owner, "Beto", { isCourier: true });
    return { owner, productId, shippingCents, ana, beto };
  }

  async function deliver(owner: Awaited<ReturnType<typeof ownerWithRestaurant>>, slug: string, productId: string, shipping: number, courierMemberId: string | null, options: OrderOptions = {}) {
    const order = await readyOrder(owner, slug, productId, { shippingCents: shipping, ...options });
    if (courierMemberId) {
      await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId });
    } else {
      await env.DB.prepare("UPDATE orders SET status = 'sent' WHERE id = ?").bind(order.id).run();
    }
    await owner.client.patch(`/api/orders/${order.id}/status`, { status: "delivered" });
    return order;
  }

  it("groups the delivered orders by courier with a 'Sin repartidor' row and the totals (scenario 30)", async () => {
    const { owner, productId, shippingCents, ana, beto } = await summaryStore();
    await deliver(owner, owner.slug, productId, shippingCents, ana.memberId);
    await deliver(owner, owner.slug, productId, shippingCents, ana.memberId, { paymentMethod: "transfer", tipCents: 50_000 });
    await deliver(owner, owner.slug, productId, shippingCents, beto.memberId);
    await deliver(owner, owner.slug, productId, shippingCents, null);
    // A cancelled one assigned to Ana never counts.
    const cancelled = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${cancelled.id}/assign`, { courierMemberId: ana.memberId });
    await owner.client.patch(`/api/orders/${cancelled.id}/status`, { status: "cancelled" });

    const res = await owner.client.get("/api/couriers/summary");
    expect(res.status).toBe(200);
    const summary = (await res.json()) as CourierSummary;
    const byName = Object.fromEntries(summary.rows.map((r) => [r.firstName ?? "Sin repartidor", r]));
    expect(byName["Ana"]).toMatchObject({ delivered: 2, shippingCents: 100_000, tipCents: 50_000, active: true });
    expect(byName["Beto"]).toMatchObject({ delivered: 1, shippingCents: 50_000, tipCents: 0, active: true });
    expect(byName["Sin repartidor"]).toMatchObject({ memberId: null, delivered: 1, shippingCents: 50_000, active: null });
    expect(summary.totals).toEqual({ delivered: 4, inProgress: 0, shippingCents: 200_000, tipCents: 50_000 });

    // Filtering by courier returns only his row (or a zero row when he has none in the range).
    const filtered = (await (await owner.client.get(`/api/couriers/summary?courierMemberId=${ana.memberId}`)).json()) as CourierSummary;
    expect(filtered.rows.map((r) => r.memberId)).toEqual([ana.memberId]);
    // A courier of another local (or unknown) is a 422.
    expect((await owner.client.get("/api/couriers/summary?courierMemberId=no-such-member")).status).toBe(422);
  });

  it("returns every courier of the local as filter options, even without deliveries in the range (scenario 48)", async () => {
    const { owner, productId, shippingCents, ana } = await summaryStore();
    const carla = await addMember(owner, "Carla", { isCourier: true });
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(carla.memberId).run();
    await deliver(owner, owner.slug, productId, shippingCents, ana.memberId);

    const summary = (await (await owner.client.get("/api/couriers/summary")).json()) as CourierSummary;
    expect(summary.couriers.map((courier) => courier.firstName)).toEqual(["Ana", "Beto", "Carla"]);
    expect(summary.couriers.find((courier) => courier.memberId === ana.memberId)).toMatchObject({ active: true });
    expect(summary.couriers.find((courier) => courier.memberId === carla.memberId)).toMatchObject({ active: false });
    // The rows still only carry the couriers with deliveries (plus "Sin repartidor").
    expect(summary.rows.map((row) => row.firstName)).toEqual(["Ana"]);
  });

  it("cuts the range on local days, so a shift across midnight stays whole when the range crosses it (scenario 31)", async () => {
    const { owner, productId, shippingCents, ana } = await summaryStore();
    const beforeMidnight = await deliver(owner, owner.slug, productId, shippingCents, ana.memberId);
    const afterMidnight = await deliver(owner, owner.slug, productId, shippingCents, ana.memberId);
    // 2026-11-02 23:50 and 2026-11-03 00:10 in Buenos Aires (UTC-3).
    await env.DB.prepare("UPDATE orders SET delivered_at = ? WHERE id = ?").bind(new Date("2026-11-03T02:50:00Z").getTime(), beforeMidnight.id).run();
    await env.DB.prepare("UPDATE orders SET delivered_at = ? WHERE id = ?").bind(new Date("2026-11-03T03:10:00Z").getTime(), afterMidnight.id).run();

    const firstDay = (await (await owner.client.get("/api/couriers/summary?from=2026-11-02&to=2026-11-02")).json()) as CourierSummary;
    expect(firstDay.totals.delivered).toBe(1);
    const bothDays = (await (await owner.client.get("/api/couriers/summary?from=2026-11-02&to=2026-11-03")).json()) as CourierSummary;
    expect(bothDays.totals.delivered).toBe(2);
  });

  it("filters by status: delivered by default, on the way by departure time, or both (scenario 30b)", async () => {
    const { owner, productId, shippingCents, ana, beto } = await summaryStore();
    await deliver(owner, owner.slug, productId, shippingCents, ana.memberId);
    const anaOnTheWay = await readyOrder(owner, owner.slug, productId, { shippingCents, paymentMethod: "transfer", tipCents: 30_000 });
    await owner.client.post(`/api/orders/${anaOnTheWay.id}/assign`, { courierMemberId: ana.memberId });
    const betoOnTheWay = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${betoOnTheWay.id}/assign`, { courierMemberId: beto.memberId });
    // Left yesterday and still on the way: outside today's range.
    const yesterday = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${yesterday.id}/assign`, { courierMemberId: beto.memberId });
    await env.DB.prepare("UPDATE orders SET sent_at = ? WHERE id = ?").bind(Date.now() - 2 * 24 * 60 * 60 * 1000, yesterday.id).run();

    const get = async (query: string) =>
      (await (await owner.client.get(`/api/couriers/summary${query}`)).json()) as CourierSummary;

    const delivered = await get("");
    expect(delivered.rows.map((row) => row.firstName)).toEqual(["Ana"]);
    expect(delivered.totals).toEqual({ delivered: 1, inProgress: 0, shippingCents: 50_000, tipCents: 0 });

    const onTheWay = await get("?status=sent");
    const byName = Object.fromEntries(onTheWay.rows.map((r) => [r.firstName, r]));
    expect(byName["Ana"]).toMatchObject({ delivered: 0, inProgress: 1, shippingCents: 50_000, tipCents: 30_000 });
    expect(byName["Beto"]).toMatchObject({ delivered: 0, inProgress: 1, shippingCents: 50_000, tipCents: 0 });
    expect(onTheWay.totals).toEqual({ delivered: 0, inProgress: 2, shippingCents: 100_000, tipCents: 30_000 });

    const all = await get("?status=all");
    expect(all.rows.find((row) => row.memberId === ana.memberId)).toMatchObject({ delivered: 1, inProgress: 1, shippingCents: 100_000, tipCents: 30_000 });
    expect(all.totals).toEqual({ delivered: 1, inProgress: 2, shippingCents: 150_000, tipCents: 30_000 });

    expect((await owner.client.get("/api/couriers/summary?status=cancelled")).status).toBe(422);
  });

  it("keeps a deactivated courier with deliveries in the range in the summary (scenario 32)", async () => {
    const { owner, productId, shippingCents, beto } = await summaryStore();
    await deliver(owner, owner.slug, productId, shippingCents, beto.memberId);
    await env.DB.prepare("UPDATE restaurant_members SET active = 0 WHERE id = ?").bind(beto.memberId).run();

    const summary = (await (await owner.client.get("/api/couriers/summary")).json()) as CourierSummary;
    expect(summary.rows.some((row) => row.memberId === beto.memberId && row.delivered === 1 && row.active === false)).toBe(true);
  });
});

describe("13 couriers: members with history and the guards (scenarios 33-34)", () => {
  it("refuses to delete a member with orders assigned, in any status, and deletes one without any (scenario 33)", async () => {
    const { owner, productId, shippingCents } = await store();
    const withHistory = await addMember(owner, "Bruno", { isCourier: true });
    const withoutHistory = await addMember(owner, "Carla", { isCourier: true });
    const order = await readyOrder(owner, owner.slug, productId, { shippingCents });
    await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: withHistory.memberId });
    await owner.client.patch(`/api/orders/${order.id}/status`, { status: "delivered" });

    const blocked = await owner.client.delete(`/api/members/${withHistory.memberId}`);
    expect(blocked.status).toBe(409);
    expect(await errorCode(blocked)).toBe("MEMBER_HAS_HISTORY");
    const still = await env.DB.prepare("SELECT count(*) AS n FROM restaurant_members WHERE id = ?").bind(withHistory.memberId).first<{ n: number }>();
    expect(still!.n).toBe(1);

    expect((await owner.client.delete(`/api/members/${withoutHistory.memberId}`)).status).toBe(204);
  });
});
