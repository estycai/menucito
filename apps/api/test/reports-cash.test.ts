import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS, computeCashTotals, type CashReport } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient } from "./helpers";
import {
  RANGE,
  addMovement,
  closeCash,
  dayAt,
  openCash,
  proStore,
  report,
  seed,
  settleOrderInto,
  stampSession,
  type Store,
} from "./report-fixtures";

const cashReport = (client: Parameters<typeof report>[0], values: Record<string, string | undefined> = RANGE) =>
  report<CashReport>(client, "cash", values);

/** A closed session on `date` at `time`, with the orders already inside the drawer. */
async function closedSession(
  store: Store,
  date: string,
  time: string,
  options: {
    openingCashCents?: number;
    countedCashCents: number;
    orders?: { id: string }[];
  },
) {
  const sessionId = await openCash(store, options.openingCashCents ?? 0);
  for (const order of options.orders ?? []) await settleOrderInto(sessionId, order.id, dayAt(date, time));
  await closeCash(store, options.countedCashCents);
  await stampSession(sessionId, dayAt(date, time), dayAt(date, "23:00"));
  return sessionId;
}

const lunch = (weekday: number, opensAt: number, closesAt: number) => ({
  weekday,
  opensAt,
  closesAt,
  fulfillment: "all" as const,
});

describe("16c cash: sessions by opening and the open drawer", () => {
  it("takes the sessions opened in the range and shows the open drawer even outside it", async () => {
    const store = await proStore();
    const closed = await seed(store, { date: "2026-06-05", paymentMethod: "cash" });
    await closedSession(store, "2026-06-05", "12:00", { openingCashCents: 100_000, countedCashCents: 200_000, orders: [closed] });

    const openId = await openCash(store, 50_000);
    const openOrder = await seed(store, { date: "2026-07-15", paymentMethod: "cash", shippingCents: 10_000 });
    await settleOrderInto(openId, openOrder.id, dayAt("2026-07-15"));
    await stampSession(openId, dayAt("2026-07-15", "12:00"), null);

    const june = await cashReport(store.client);
    expect(june.widgets.kpis).toMatchObject({ sessions: 1, closed: 1, inProgress: 0 });
    expect(june.widgets.sessions).toHaveLength(1);
    expect(june.widgets.open?.openedAt).toBe(dayAt("2026-07-15", "12:00"));
    expect(june.widgets.open).toMatchObject({ cashSalesCents: 110_000, openingCashCents: 50_000, cashCents: 160_000 });

    const may = await cashReport(store.client, { from: "2026-05-01", to: "2026-05-31" });
    expect(may.widgets.sessions).toEqual([]);
    expect(may.widgets.open).toBeDefined();
    expect(may.hasActivity).toBe(true);
  });
});

describe("16c cash: a closed session keeps its close", () => {
  it("uses the close snapshot, as the Cajas history does, even if an order changes later", async () => {
    const store = await proStore();
    const order = await seed(store, { date: "2026-06-05", paymentMethod: "cash" });
    const sessionId = await closedSession(store, "2026-06-05", "12:00", { countedCashCents: 100_000, orders: [order] });

    const before = await cashReport(store.client);
    expect(before.widgets.sessions?.[0]).toMatchObject({ id: sessionId, orders: 1, salesCents: 100_000 });

    await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(order.id).run();
    const after = await cashReport(store.client);
    expect(after.widgets.sessions?.[0]).toMatchObject({ orders: 1, salesCents: 100_000, differenceCents: 0 });
    expect(after.widgets.kpis).toMatchObject({ salesCents: 100_000, orders: 1 });
  });
});

describe("16c cash: totals and tables", () => {
  it("matches computeCashTotals with incomes, expenses and tips, and closes the tables", async () => {
    const store = await proStore();
    const sessionId = await openCash(store, 50_000);
    const cashOrder = await seed(store, { date: "2026-06-10", paymentMethod: "cash", shippingCents: 10_000 });
    const transferOrder = await seed(store, { date: "2026-06-10", paymentMethod: "transfer", tipCents: 5_000 });
    await settleOrderInto(sessionId, cashOrder.id, dayAt("2026-06-10"));
    await settleOrderInto(sessionId, transferOrder.id, dayAt("2026-06-10"));
    await addMovement(store, { kind: "income", amountCents: 10_000, comment: "Aporte" });
    await addMovement(store, { kind: "expense", method: "transfer", amountCents: 5_000, comment: "Flete" });
    await closeCash(store, 170_000);
    await stampSession(sessionId, dayAt("2026-06-10", "12:00"), dayAt("2026-06-10", "23:00"));

    const { widgets } = await cashReport(store.client);
    const expected = computeCashTotals({
      openingCashCents: 50_000,
      sales: [
        { method: "cash", amountCents: 110_000 },
        { method: "transfer", amountCents: 100_000, tipCents: 5_000 },
      ],
      movements: [
        { method: "cash", kind: "income", amountCents: 10_000 },
        { method: "transfer", kind: "expense", amountCents: 5_000 },
      ],
    });
    expect(widgets.kpis?.salesCents).toBe(expected.salesCents);
    expect(widgets.sessions?.[0]?.expectedCashCents).toBe(expected.expectedCashCents);
    expect(widgets.kpis).toMatchObject({
      sessions: 1,
      closed: 1,
      inProgress: 0,
      salesCents: 210_000,
      orders: 2,
      incomeCents: 10_000,
      expenseCents: 5_000,
      expectedCents: 170_000,
      countedCents: 170_000,
      differenceCents: 0,
      balanced: 1,
    });

    const cash = widgets.by_method?.rows.find((row) => row.method === "cash");
    const transfer = widgets.by_method?.rows.find((row) => row.method === "transfer");
    expect(cash).toMatchObject({ orders: 1, salesCents: 110_000, incomeCents: 10_000, expenseCents: 0 });
    // The tips are inside Transferencia, as in the Cajas screen.
    expect(transfer).toMatchObject({ orders: 1, salesCents: 105_000, incomeCents: 0, expenseCents: 5_000 });
    expect(widgets.by_method?.total).toMatchObject({ salesCents: 215_000, incomeCents: 10_000, expenseCents: 5_000 });

    expect(widgets.sessions?.[0]).toMatchObject({
      orders: 2,
      salesCents: 210_000,
      expenseCents: 5_000,
      expectedCashCents: 170_000,
      countedCashCents: 170_000,
      differenceCents: 0,
    });
  });

  it("leaves the voided movements out and groups the comments of the others", async () => {
    const store = await proStore();
    const sessionId = await openCash(store);
    const order = await seed(store, { date: "2026-06-11", paymentMethod: "cash" });
    await settleOrderInto(sessionId, order.id, dayAt("2026-06-11"));
    await addMovement(store, { kind: "expense", amountCents: 2_000, comment: "Compra de hielo" });
    await addMovement(store, { kind: "expense", amountCents: 3_000, comment: "COMPRA  DE HIELO" });
    const voided = await addMovement(store, { kind: "expense", amountCents: 9_000, comment: "Compra de hielo" });
    expect((await store.client.post(`/api/cash-sessions/current/movements/${voided}/void`, {})).status).toBe(200);
    await addMovement(store, { kind: "income", amountCents: 5_000, comment: "Aporte" });
    await closeCash(store, 100_000);
    await stampSession(sessionId, dayAt("2026-06-11", "12:00"), dayAt("2026-06-11", "23:00"));

    const { widgets } = await cashReport(store.client);
    expect(widgets.movements).toEqual([
      { kind: "income", concept: "Aporte", direction: "income", count: 1, amountCents: 5_000 },
      { kind: "expense", concept: "Compra de hielo", direction: "expense", count: 2, amountCents: 5_000 },
    ]);
  });

  it("filters by method only the method table and the movements, and groups by shift", async () => {
    const store = await proStore();
    const hours = await store.client.put("/api/restaurants/me/hours", {
      slots: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [lunch(weekday, 690, 930), lunch(weekday, 1140, 1410)]),
    });
    expect(hours.status).toBe(200);
    const lunchOrder = await seed(store, { date: "2026-06-10", paymentMethod: "cash" });
    const lunchTransfer = await seed(store, { date: "2026-06-10", paymentMethod: "transfer" });
    const lunchSession = await openCash(store);
    await settleOrderInto(lunchSession, lunchOrder.id, dayAt("2026-06-10", "12:00"));
    await settleOrderInto(lunchSession, lunchTransfer.id, dayAt("2026-06-10", "12:00"));
    await addMovement(store, { kind: "income", amountCents: 1_000, comment: "Caja chica" });
    await addMovement(store, { kind: "income", method: "transfer", amountCents: 2_000, comment: "Transferencia" });
    await closeCash(store, 101_000);
    await stampSession(lunchSession, dayAt("2026-06-10", "12:00"), dayAt("2026-06-10", "15:00"));

    const nightOrder = await seed(store, { date: "2026-06-10", paymentMethod: "cash" });
    await closedSession(store, "2026-06-10", "20:00", { countedCashCents: 100_000, orders: [nightOrder] });

    const all = await cashReport(store.client);
    expect(all.widgets.by_shift?.rows.map((row) => row.label)).toEqual(["Mediodía", "Noche"]);
    expect(all.widgets.by_shift?.rows[0]).toMatchObject({ sessions: 1, orders: 2, salesCents: 200_000 });
    expect(all.widgets.by_shift?.total).toMatchObject({ sessions: 2, orders: 3, salesCents: 300_000 });

    const onlyCash = await cashReport(store.client, { ...RANGE, payment: "cash" });
    expect(onlyCash.widgets.by_method?.rows.map((row) => row.method)).toEqual(["cash"]);
    expect(onlyCash.widgets.movements?.map((row) => row.concept)).toEqual(["Caja chica"]);
    expect(onlyCash.widgets.kpis?.salesCents).toBe(300_000);
    expect(onlyCash.widgets.kpis?.sessions).toBe(2);

    const onlyLunch = await cashReport(store.client, { ...RANGE, shift: "690-930" });
    expect(onlyLunch.widgets.kpis).toMatchObject({ sessions: 1, orders: 2 });
    expect(onlyLunch.widgets.sessions).toHaveLength(1);
    expect(onlyLunch.widgets.by_shift?.rows.map((row) => row.label)).toEqual(["Mediodía"]);
  });
});

describe("16c cash: blind close and permissions", () => {
  it("hides the expected, the counted, the difference and the cash on hand without cash.expected", async () => {
    const store = await proStore();
    const order = await seed(store, { date: "2026-06-12", paymentMethod: "cash" });
    await closedSession(store, "2026-06-12", "12:00", { openingCashCents: 20_000, countedCashCents: 120_000, orders: [order] });

    const owner = await cashReport(store.client);
    expect(owner.widgets.kpis?.differenceCents).toBe(0);
    expect(owner.widgets.sessions?.[0]?.expectedCashCents).toBe(120_000);

    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", ...GRANTED_REPORT_PERMISSION_KEYS, "cash.view"],
    });
    const blind = await cashReport(staff.client);
    expect(blind.widgets.kpis?.salesCents).toBe(100_000);
    expect(blind.widgets.kpis).not.toHaveProperty("differenceCents");
    expect(blind.widgets.kpis).not.toHaveProperty("expectedCents");
    expect(blind.widgets.kpis).not.toHaveProperty("countedCents");
    expect(blind.widgets.kpis).not.toHaveProperty("balanced");
    expect(blind.widgets.by_shift?.rows[0]).not.toHaveProperty("differenceCents");
    expect(blind.widgets.sessions?.[0]).not.toHaveProperty("expectedCashCents");
    expect(blind.widgets.sessions?.[0]).not.toHaveProperty("countedCashCents");
    expect(blind.widgets.sessions?.[0]).not.toHaveProperty("differenceCents");
  });

  it("omits the blocks the role lacks and refuses the tab or the Basic plan", async () => {
    const store = await proStore();
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.cash", "stats.f.date", "stats.w.cash.kpis"],
    });
    expect(Object.keys((await cashReport(staff.client)).widgets)).toEqual(["kpis"]);

    const withoutTab = await staffClient({ owner: store, permissions: ["stats.view"] });
    const forbidden = await withoutTab.client.get("/api/reports/cash");
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const basic = await ownerWithRestaurant();
    const res = await basic.client.get("/api/reports/cash");
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
  });
});
