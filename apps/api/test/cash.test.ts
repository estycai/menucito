import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
  CashCloseResult,
  CashCurrent,
  CashHistory,
  CashSession,
  CashSessionDetail,
  Category,
  OrderDetail,
  Product,
  Role,
} from "@menucito/shared";
import {
  Client,
  TEST_PASSWORD,
  errorCode,
  ownerWithRestaurant,
  signedInClient,
  staffClient,
  unique,
  type OwnerFixture,
} from "./helpers";

let counter = 0;
const uuid = () => "40000000-0000-4000-8000-" + String(counter++).padStart(12, "0");
const nextPhone = () => `11 6666 ${String(1000 + counter++).slice(-4)}`;
const AMOUNT = 100_000;

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
      { method: "split", enabled: true },
    ],
  });
  expect(settings.status).toBe(200);
  return { owner, productId: product.id, shippingCents };
}

interface OrderOptions {
  fulfillment?: "delivery" | "takeaway";
  paymentMethod?: "cash" | "transfer" | "split";
  tipCents?: number;
  splitCashCents?: number;
  cashTenderedCents?: number;
  shippingCents?: number;
}

async function createOrder(slug: string, productId: string, options: OrderOptions = {}) {
  const fulfillment = options.fulfillment ?? "takeaway";
  const paymentMethod = options.paymentMethod ?? "cash";
  const tipCents = options.tipCents ?? 0;
  const shipping = fulfillment === "delivery" ? (options.shippingCents ?? 0) : 0;
  const total = AMOUNT + shipping + tipCents;
  const res = await new Client().post(`/api/public/menus/${slug}/orders`, {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan", phone: nextPhone(), address: fulfillment === "delivery" ? "Calle 1" : null },
    fulfillment,
    paymentMethod,
    clientOrderId: uuid(),
    tipCents,
    ...(paymentMethod === "split" ? { splitCashCents: options.splitCashCents ?? AMOUNT / 2 } : {}),
    ...(options.cashTenderedCents !== undefined ? { cashTenderedCents: options.cashTenderedCents } : {}),
    expectedTotalCents: total,
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { order: { number: number } };
  const row = await env.DB.prepare(
    "SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE r.slug = ? AND o.number = ?",
  )
    .bind(slug, data.order.number)
    .first<{ id: string }>();
  expect(row).not.toBeNull();
  return { id: row!.id, number: data.order.number, totalCents: total, shippingCents: shipping };
}

async function addCourier(owner: OwnerFixture, firstName = "Juan") {
  const role = (await (await owner.client.post("/api/roles", { name: `Rol ${unique()}`, permissions: [] })).json()) as Role;
  const email = `courier${unique()}@example.com`;
  const res = await owner.client.post("/api/members", {
    firstName,
    lastName: "Reparto",
    email,
    password: TEST_PASSWORD,
    roleId: role.id,
    isCourier: true,
  });
  expect(res.status).toBe(201);
  const member = (await res.json()) as { id: string };
  return { memberId: member.id, client: await signedInClient(email) };
}

async function deliver(
  owner: OwnerFixture,
  courier: { memberId: string; client: Client },
  orderId: string,
) {
  expect((await owner.client.patch(`/api/orders/${orderId}/status`, { status: "ready" })).status).toBe(200);
  expect((await owner.client.post(`/api/orders/${orderId}/assign`, { courierMemberId: courier.memberId })).status).toBe(200);
  expect((await courier.client.post(`/api/deliveries/${orderId}/delivered`, {})).status).toBe(200);
}

const currentOf = async (client: Client): Promise<CashCurrent> => {
  const res = await client.get("/api/cash-sessions/current");
  return (await res.json()) as CashCurrent;
};
const openCash = (owner: OwnerFixture, openingCashCents = 2_000_000) =>
  owner.client.post("/api/cash-sessions", { openingCashCents });

describe("14b cash sessions", () => {
  it("opens one session, suggests the previous count and refuses a second (scenarios 1-5)", async () => {
    const { owner } = await store();
    const opened = await openCash(owner);
    expect(opened.status).toBe(201);
    const session = (await opened.json()) as CashSession;
    expect(session).toMatchObject({ openingCashCents: 2_000_000, openedByName: "Marta Gómez", closedAt: null });

    const current = await currentOf(owner.client);
    expect(current.session?.id).toBe(session.id);
    expect(current.openingSuggestionCents).toBe(0);
    expect(current.totals?.cash.openingCents).toBe(2_000_000);
    expect(current.totals?.expectedCashCents).toBe(2_000_000);

    const second = await openCash(owner);
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("CASH_SESSION_ALREADY_OPEN");
  });

  it("enters takeaway cash and transfers when paid, and delivery cash only on settlement (scenarios 7-14)", async () => {
    const { owner, productId } = await store();
    await openCash(owner);
    const courier = await addCourier(owner);

    const takeaway = await createOrder(owner.slug, productId);
    expect((await owner.client.patch(`/api/orders/${takeaway.id}/payment`, { paymentStatus: "paid" })).status).toBe(200);
    let current = await currentOf(owner.client);
    expect(current.totals?.cash.salesCents).toBe(AMOUNT);
    expect(current.totals?.cash.salesCount).toBe(1);

    const transfer = await createOrder(owner.slug, productId, { paymentMethod: "transfer", fulfillment: "delivery" });
    expect((await owner.client.patch(`/api/orders/${transfer.id}/payment`, { paymentStatus: "paid" })).status).toBe(200);
    current = await currentOf(owner.client);
    expect(current.totals?.transfer.salesCents).toBe(AMOUNT);
    expect(current.totals?.salesCents).toBe(AMOUNT * 2);

    const delivery = await createOrder(owner.slug, productId, { fulfillment: "delivery" });
    await deliver(owner, courier, delivery.id);
    current = await currentOf(owner.client);
    expect(current.totals?.cash.salesCents).toBe(AMOUNT);
    expect(current.toSettle).toHaveLength(1);
    expect(current.toSettle[0]).toMatchObject({
      courier: { memberId: courier.memberId, firstName: "Juan" },
      ordersCents: AMOUNT,
    });
    expect(current.onTheStreet.ordersCents).toBe(AMOUNT);

    const settled = await owner.client.post("/api/cash-sessions/current/settlements", { orderIds: [delivery.id] });
    expect(settled.status).toBe(201);
    current = await currentOf(owner.client);
    expect(current.toSettle).toHaveLength(0);
    expect(current.totals?.cash.salesCents).toBe(AMOUNT * 2);

    const detail = (await (await owner.client.get(`/api/orders/${delivery.id}`)).json()) as OrderDetail;
    expect(detail.settledAt).toEqual(expect.any(Number));
    expect(detail.cashSessionId).toBe(current.session?.id);

    const pending = await owner.client.patch(`/api/orders/${delivery.id}/payment`, { paymentStatus: "pending" });
    expect(pending.status).toBe(409);
    expect(await errorCode(pending)).toBe("ORDER_SETTLED");

    const undone = await owner.client.delete(`/api/cash-sessions/current/settlements/${delivery.id}`);
    expect(undone.status).toBe(204);
    expect((await owner.client.patch(`/api/orders/${delivery.id}/payment`, { paymentStatus: "pending" })).status).toBe(200);
  });

  it("enters a split delivery as two incomes and never as a sale (scenarios 15-16, Q31)", async () => {
    const { owner, productId } = await store();
    await openCash(owner);
    const courier = await addCourier(owner);
    const split = await createOrder(owner.slug, productId, {
      fulfillment: "delivery",
      paymentMethod: "split",
      splitCashCents: 40_000,
    });
    await deliver(owner, courier, split.id);

    let current = await currentOf(owner.client);
    expect(current.toSettle[0]).toMatchObject({ ordersCents: 40_000 });

    expect((await owner.client.post("/api/cash-sessions/current/courier-change", { courierMemberId: courier.memberId, amountCents: 5_000 })).status).toBe(201);
    expect(
      (await owner.client.post("/api/cash-sessions/current/settlements", {
        orderIds: [split.id],
        changeBackCents: 5_000,
      })).status,
    ).toBe(201);

    current = await currentOf(owner.client);
    expect(current.totals?.cash.salesCount).toBe(0);
    expect(current.totals?.transfer.salesCount).toBe(0);
    const splitIncomes = current.movements.filter((movement) => movement.kind === "order_split_income");
    expect(splitIncomes).toHaveLength(2);
    expect(splitIncomes.map((movement) => movement.comment).sort()).toEqual([
      "Ingreso Pedido #1 - Efectivo",
      "Ingreso Pedido #1 - Transferencia",
    ]);
    expect(current.totals?.cash.totalCents).toBe(2_040_000);
    expect(current.totals?.transfer.totalCents).toBe(60_000);

    const automatic = splitIncomes[0]!;
    const edit = await owner.client.patch(`/api/cash-sessions/current/movements/${automatic.id}`, {
      method: "cash",
      amountCents: 1,
    });
    expect(edit.status).toBe(409);
    expect(await errorCode(edit)).toBe("MOVEMENT_LOCKED");
    const voided = await owner.client.post(`/api/cash-sessions/current/movements/${automatic.id}/void`, {});
    expect(voided.status).toBe(409);
    expect(await errorCode(voided)).toBe("MOVEMENT_LOCKED");

    // A split takeaway paid into the open cash enters as two incomes; cancelling it removes them.
    const takeawaySplit = await createOrder(owner.slug, productId, {
      paymentMethod: "split",
      splitCashCents: 30_000,
    });
    expect((await owner.client.patch(`/api/orders/${takeawaySplit.id}/payment`, { paymentStatus: "paid" })).status).toBe(200);
    current = await currentOf(owner.client);
    expect(current.movements.filter((movement) => movement.orderId === takeawaySplit.id)).toHaveLength(2);
    expect((await owner.client.patch(`/api/orders/${takeawaySplit.id}/status`, { status: "cancelled" })).status).toBe(200);
    current = await currentOf(owner.client);
    expect(current.movements.filter((movement) => movement.orderId === takeawaySplit.id)).toHaveLength(0);
    expect(current.totals?.cash.incomeCents).toBe(45_000);
    expect(current.totals?.transfer.incomeCents).toBe(60_000);
  });

  it("creates, edits and voids a split manual movement (scenarios 22-25)", async () => {
    const { owner } = await store();
    await openCash(owner);

    expect(
      (await owner.client.post("/api/cash-sessions/current/movements", {
        kind: "income",
        method: "split",
        cashCents: 5_000,
        transferCents: 5_000,
        comment: "Cambio de proveedor",
      })).status,
    ).toBe(201);
    let current = await currentOf(owner.client);
    expect(current.movements).toHaveLength(1);
    const movement = current.movements[0]!;
    expect(movement).toMatchObject({ method: "split", amountCents: 10_000, cashCents: 5_000, transferCents: 5_000 });
    expect(current.totals?.cash.incomeCents).toBe(5_000);
    expect(current.totals?.transfer.incomeCents).toBe(5_000);

    const edited = await owner.client.patch(`/api/cash-sessions/current/movements/${movement.id}`, {
      method: "cash",
      amountCents: 8_000,
      comment: "Corregido",
    });
    expect(edited.status).toBe(200);
    current = await currentOf(owner.client);
    expect(current.movements[0]).toMatchObject({
      method: "cash",
      amountCents: 8_000,
      comment: "Corregido",
      editedByName: "Marta Gómez",
    });
    expect(current.totals?.cash.incomeCents).toBe(8_000);
    expect(current.totals?.transfer.incomeCents).toBe(0);

    expect(
      (await owner.client.post(`/api/cash-sessions/current/movements/${movement.id}/void`, {})).status,
    ).toBe(200);
    current = await currentOf(owner.client);
    expect(current.movements[0]?.voidedAt).toEqual(expect.any(Number));
    expect(current.totals?.cash.incomeCents).toBe(0);
    expect(current.totals?.transfer.incomeCents).toBe(0);
  });

  it("closes with a snapshot, keeps the arqueo immutable and closes blind without cash.expected (scenarios 44-55)", async () => {
    const { owner, productId } = await store();
    const staff = await staffClient({ owner, permissions: ["cash.view", "cash.close"] });
    await openCash(owner);
    const cashOrder = await createOrder(owner.slug, productId);
    await owner.client.patch(`/api/orders/${cashOrder.id}/payment`, { paymentStatus: "paid" });

    const blind = await currentOf(staff.client);
    expect(blind.session).not.toBeNull();
    expect(blind.totals?.cash.salesCents).toBe(AMOUNT);
    expect(blind.totals?.cash.totalCents).toBeNull();
    expect(blind.totals?.expectedCashCents).toBeNull();

    const closed = await staff.client.post("/api/cash-sessions/current/close", {
      countedCashCents: 2_100_000,
      note: "Cierre de prueba",
    });
    expect(closed.status).toBe(200);
    const result = (await closed.json()) as CashCloseResult;
    expect(result.detail.session.expectedCashCents).toBe(2_100_000);
    expect(result.detail.session.countedCashCents).toBe(2_100_000);
    expect(result.detail.session.differenceCents).toBe(0);
    expect(result.detail.session.closedByName).toContain("Ana");

    const after = await currentOf(owner.client);
    expect(after.session).toBeNull();
    expect(after.openingSuggestionCents).toBe(2_100_000);
    expect(after.lastClosed?.id).toBe(result.detail.session.id);

    const history = (await (await owner.client.get("/api/cash-sessions")).json()) as CashHistory;
    expect(history.sessions.map((session) => session.id)).toContain(result.detail.session.id);

    const beforeCancel = (await (
      await owner.client.get(`/api/cash-sessions/${result.detail.session.id}`)
    ).json()) as CashSessionDetail;
    expect(beforeCancel.totals.cash.salesCents).toBe(AMOUNT);

    // A cancellation after the close changes the order, never the closed snapshot.
    expect((await owner.client.patch(`/api/orders/${cashOrder.id}/status`, { status: "cancelled" })).status).toBe(200);
    const afterCancel = (await (
      await owner.client.get(`/api/cash-sessions/${result.detail.session.id}`)
    ).json()) as CashSessionDetail;
    expect(afterCancel.totals.cash.salesCents).toBe(AMOUNT);
    expect(afterCancel.session.differenceCents).toBe(0);

    // A payment after the close stays outside every cash.
    const later = await createOrder(owner.slug, productId);
    await owner.client.patch(`/api/orders/${later.id}/payment`, { paymentStatus: "paid" });
    const laterDetail = (await (await owner.client.get(`/api/orders/${later.id}`)).json()) as OrderDetail;
    expect(laterDetail.cashSessionId).toBeNull();
    const now = await currentOf(owner.client);
    expect(now.chargedWithoutCashToday.count).toBe(1);
  });

  it("suggests the courier payment and records it as a movement (scenarios 32-37)", async () => {
    const { owner, productId } = await store(50_000);
    await openCash(owner);
    const courier = await addCourier(owner, "Pedro");
    const order = await createOrder(owner.slug, productId, { fulfillment: "delivery", shippingCents: 50_000 });
    await deliver(owner, courier, order.id);
    await owner.client.post("/api/cash-sessions/current/settlements", { orderIds: [order.id] });

    let current = await currentOf(owner.client);
    const account = current.courierAccounts.find((candidate) => candidate.courier.memberId === courier.memberId)!;
    expect(account).toMatchObject({ shippingCents: 50_000, tipCents: 0, paidCents: 0, suggestedCents: 50_000 });

    // Change suggestion: the change of the courier's orders on the way, not the delivered one.
    const onTheWay = await createOrder(owner.slug, productId, {
      fulfillment: "delivery",
      shippingCents: 50_000,
      cashTenderedCents: 200_000,
    });
    expect((await owner.client.patch(`/api/orders/${onTheWay.id}/status`, { status: "ready" })).status).toBe(200);
    expect(
      (await owner.client.post(`/api/orders/${onTheWay.id}/assign`, { courierMemberId: courier.memberId })).status,
    ).toBe(200);
    current = await currentOf(owner.client);
    expect(
      current.courierAccounts.find((candidate) => candidate.courier.memberId === courier.memberId)?.changeSuggestionCents,
    ).toBe(50_000);

    const pay = await owner.client.post("/api/cash-sessions/current/movements", {
      kind: "courier_payment",
      method: "cash",
      amountCents: 50_000,
      courierMemberId: courier.memberId,
      comment: "Envíos y propinas",
    });
    expect(pay.status).toBe(201);
    current = await currentOf(owner.client);
    const paid = current.courierAccounts.find((candidate) => candidate.courier.memberId === courier.memberId)!;
    expect(paid).toMatchObject({ paidCents: 50_000, suggestedCents: 0 });
    expect(current.movements[0]).toMatchObject({ kind: "courier_payment", amountCents: 50_000 });

    const splitPayment = await owner.client.post("/api/cash-sessions/current/movements", {
      kind: "courier_payment",
      method: "split",
      cashCents: 25_000,
      transferCents: 25_000,
      courierMemberId: courier.memberId,
    });
    expect(splitPayment.status).toBe(422);
  });

  it("lists only orders a courier handed in as courier incomes, never takeaway sales", async () => {
    const { owner, productId } = await store();
    const courier = await addCourier(owner);
    await openCash(owner);
    const takeaway = await createOrder(owner.slug, productId);
    await owner.client.patch(`/api/orders/${takeaway.id}/payment`, { paymentStatus: "paid" });
    const delivery = await createOrder(owner.slug, productId, { fulfillment: "delivery" });
    await deliver(owner, courier, delivery.id);
    await owner.client.post("/api/cash-sessions/current/settlements", { orderIds: [delivery.id] });

    const closed = (await (
      await owner.client.post("/api/cash-sessions/current/close", { countedCashCents: 0 })
    ).json()) as CashCloseResult;
    expect(closed.detail.courierIncomes).toHaveLength(1);
    expect(closed.detail.courierIncomes[0]).toMatchObject({
      courier: { memberId: courier.memberId },
      ordersCount: 1,
      cents: delivery.totalCents,
    });
  });

  it("refuses cash actions without their permission and needs an open session", async () => {
    const { owner } = await store();
    const viewer = await staffClient({ owner, permissions: ["cash.view"] });
    expect((await viewer.client.get("/api/cash-sessions/current")).status).toBe(200);
    expect((await viewer.client.post("/api/cash-sessions", { openingCashCents: 0 })).status).toBe(403);

    const outsider = await staffClient({
      owner,
      permissions: ["orders.view"],
    });
    expect((await outsider.client.get("/api/cash-sessions/current")).status).toBe(403);

    const noSession = await owner.client.post("/api/cash-sessions/current/settlements", { orderIds: ["x"] });
    expect(noSession.status).toBe(409);
    expect(await errorCode(noSession)).toBe("NO_OPEN_CASH_SESSION");
  });
});
