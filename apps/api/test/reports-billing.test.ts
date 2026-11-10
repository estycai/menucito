import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS, type BillingReport, type SalesReport } from "@menucito/shared";
import { errorCode, ownerWithRestaurant, staffClient } from "./helpers";
import { RANGE, proStore, report, seed } from "./report-fixtures";

const billing = (client: Parameters<typeof report>[0], values: Record<string, string | undefined> = RANGE) =>
  report<BillingReport>(client, "billing", values);

describe("16b billing: totals and tables", () => {
  it("closes the method rows, the modalities and the tables with the real totals", async () => {
    const store = await proStore();
    await seed(store, {
      date: "2026-06-02",
      quantity: 2,
      paymentMethod: "cash",
      shippingCents: 20_000,
      discountCents: 10_000,
      totalCents: 210_000,
    });
    await seed(store, { date: "2026-06-03", fulfillment: "takeaway", paymentMethod: "transfer" });

    const { widgets } = await billing(store.client);

    expect(widgets.total).toMatchObject({ billedCents: 310_000, orders: 2 });
    expect(widgets.total?.rows).toEqual([
      { method: "cash", orders: 1, billedCents: 210_000, percent: 67.7 },
      { method: "transfer", orders: 1, billedCents: 100_000, percent: 32.3 },
    ]);

    expect(widgets.orders_total).toEqual({
      orders: 2,
      rows: [
        { fulfillment: "delivery", orders: 1, percent: 50 },
        { fulfillment: "takeaway", orders: 1, percent: 50 },
      ],
    });

    expect(widgets.delivery?.rows).toEqual([
      { method: "cash", orders: 1, ticketCents: 190_000, productsCents: 190_000, shippingCents: 20_000, tipsCents: 0, billedCents: 210_000 },
      { method: "transfer", orders: 0, ticketCents: 0, productsCents: 0, shippingCents: 0, tipsCents: 0, billedCents: 0 },
    ]);
    expect(widgets.delivery?.total).toEqual({
      orders: 1,
      ticketCents: 190_000,
      productsCents: 190_000,
      shippingCents: 20_000,
      tipsCents: 0,
      billedCents: 210_000,
    });

    expect(widgets.takeaway?.rows).toEqual([
      { method: "cash", orders: 0, ticketCents: 0, productsCents: 0, billedCents: 0 },
      { method: "transfer", orders: 1, ticketCents: 100_000, productsCents: 100_000, billedCents: 100_000 },
    ]);
    expect(widgets.takeaway?.total).toEqual({ orders: 1, ticketCents: 100_000, productsCents: 100_000, billedCents: 100_000 });

    expect(widgets.source).toEqual([
      { source: "web", orders: 2, ticketCents: 145_000, billedCents: 310_000, percent: 100 },
      { source: "local", orders: 0, ticketCents: 0, billedCents: 0, percent: 0 },
      { source: "whatsapp", orders: 0, ticketCents: 0, billedCents: 0, percent: 0 },
    ]);
  });

  it("splits a divided order in proportion: the cash side is exactly what was paid in cash", async () => {
    const store = await proStore();
    await seed(store, {
      date: "2026-06-02",
      paymentMethod: "split",
      splitCashCents: 33_333,
      shippingCents: 10_000,
      totalCents: 110_000,
    });

    const { widgets } = await billing(store.client);

    expect(widgets.delivery?.rows).toEqual([
      { method: "cash", orders: 1, ticketCents: 30_303, productsCents: 30_303, shippingCents: 3_030, tipsCents: 0, billedCents: 33_333 },
      { method: "transfer", orders: 1, ticketCents: 69_697, productsCents: 69_697, shippingCents: 6_970, tipsCents: 0, billedCents: 76_667 },
    ]);
    expect(widgets.delivery?.total?.billedCents).toBe(110_000);
    // No cent is lost: the two shares add up to the order.
    expect((widgets.delivery?.rows[0]?.billedCents ?? 0) + (widgets.delivery?.rows[1]?.billedCents ?? 0)).toBe(110_000);
    expect(widgets.total?.rows.map((row) => row.percent)).toEqual([30.3, 69.7]);
    expect(widgets.total?.billedCents).toBe(110_000);
  });

  it("shows only the modality picked in the filter", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02" });
    await seed(store, { date: "2026-06-02", fulfillment: "takeaway" });

    const { widgets } = await billing(store.client, { ...RANGE, fulfillment: "takeaway" });
    expect(widgets.delivery).toBeUndefined();
    expect(widgets.takeaway).toBeDefined();
    expect(widgets.orders_total?.rows).toEqual([{ fulfillment: "takeaway", orders: 1, percent: 100 }]);
  });

  it("under Efectivo a split order adds only its cash part and the transfer row is not shown", async () => {
    const store = await proStore();
    await seed(store, {
      date: "2026-06-02",
      paymentMethod: "split",
      splitCashCents: 33_000,
      shippingCents: 10_000,
      totalCents: 110_000,
    });
    await seed(store, { date: "2026-06-02", paymentMethod: "cash" });

    const { widgets } = await billing(store.client, { ...RANGE, payment: "cash" });
    expect(widgets.total).toMatchObject({ billedCents: 133_000, orders: 2 });
    expect(widgets.total?.rows).toEqual([{ method: "cash", orders: 2, billedCents: 133_000, percent: 100 }]);
    expect(widgets.delivery?.rows.map((row) => row.method)).toEqual(["cash"]);
    expect(widgets.delivery?.total?.billedCents).toBe(133_000);
    expect(widgets.source?.[0]?.billedCents).toBe(133_000);
  });

  it("shows the tips only in delivery, and only on the transfer row", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "transfer", tipCents: 5_000 });

    const { widgets } = await billing(store.client);
    expect(widgets.delivery?.rows[0]).toMatchObject({ method: "cash", tipsCents: 0 });
    expect(widgets.delivery?.rows[1]).toMatchObject({ method: "transfer", tipsCents: 5_000 });
    expect(widgets.delivery?.total).toMatchObject({ tipsCents: 5_000, billedCents: 105_000 });
    expect(widgets.takeaway?.rows.some((row) => "tipsCents" in row)).toBe(false);
    expect(widgets.takeaway?.total).not.toHaveProperty("tipsCents");
  });

  it("shows the three origins in a fixed order, with their share of the total", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", source: "web" });
    await seed(store, { date: "2026-06-02", source: "local", quantity: 3 });
    await seed(store, { date: "2026-06-02", source: "whatsapp", quantity: 2 });

    const { widgets } = await billing(store.client);
    expect(widgets.source).toEqual([
      { source: "web", orders: 1, ticketCents: 100_000, billedCents: 100_000, percent: 16.7 },
      { source: "local", orders: 1, ticketCents: 300_000, billedCents: 300_000, percent: 50 },
      { source: "whatsapp", orders: 1, ticketCents: 200_000, billedCents: 200_000, percent: 33.3 },
    ]);
  });

  it("omits a disabled modality without sales, and keeps it when the period has sales", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02" });
    await seed(store, { date: "2026-06-03", fulfillment: "takeaway" });
    // The store's modalities are set when the restaurant is created; the report reads them from `restaurants`.
    await env.DB.prepare("UPDATE restaurants SET takeaway = 0 WHERE id = ?").bind(store.restaurantId).run();

    const disabled = await billing(store.client, { from: "2026-06-01", to: "2026-06-02" });
    expect(disabled.widgets.delivery).toBeDefined();
    expect(disabled.widgets.takeaway).toBeUndefined();
    expect(disabled.widgets.orders_total?.rows).toEqual([{ fulfillment: "delivery", orders: 1, percent: 100 }]);

    const withSales = await billing(store.client);
    expect(withSales.widgets.takeaway).toBeDefined();
  });
});

describe("16b billing: permissions", () => {
  it("hides the cents and ranks the percentages by orders without amounts", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "cash" });
    await seed(store, { date: "2026-06-02", paymentMethod: "transfer", source: "local" });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", ...GRANTED_REPORT_PERMISSION_KEYS.filter((key) => key !== "stats.amounts")],
    });

    const { widgets } = await billing(staff.client);
    expect(JSON.stringify(widgets)).not.toContain("Cents");
    expect(widgets.total?.rows.every((row) => row.billedCents === undefined)).toBe(true);
    expect(widgets.total?.rows.map((row) => row.percent)).toEqual([50, 50]);
    expect(widgets.source?.map((row) => row.percent)).toEqual([50, 50, 0]);
    expect(widgets.delivery?.rows.every((row) => row.productsCents === undefined)).toBe(true);
  });

  it("omits the blocks the role lacks and refuses the tab or the Basic plan", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02" });
    const staff = await staffClient({
      owner: store,
      permissions: ["stats.view", "stats.tab.billing", "stats.f.date", "stats.w.billing.total"],
    });
    expect(Object.keys((await billing(staff.client)).widgets)).toEqual(["total"]);

    const withoutTab = await staffClient({ owner: store, permissions: ["stats.view"] });
    const forbidden = await withoutTab.client.get("/api/reports/billing");
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const basic = await ownerWithRestaurant();
    const res = await basic.client.get("/api/reports/billing");
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("PLAN_FEATURE");
  });
});

describe("16b billing: exact cash part and activity", () => {
  it("the cash part of a split order adds up to exactly what was paid in cash", async () => {
    const store = await proStore();
    await seed(store, { date: "2026-06-02", paymentMethod: "split", splitCashCents: 33_333, shippingCents: 7_777, discountCents: 1_111 });
    const { widgets } = await billing(store.client);
    const cash = widgets.delivery?.rows.find((row) => row.method === "cash");
    const transfer = widgets.delivery?.rows.find((row) => row.method === "transfer");
    expect(cash?.billedCents).toBe(33_333);
    expect((cash?.billedCents ?? 0) + (transfer?.billedCents ?? 0)).toBe(widgets.delivery?.total.billedCents);
    expect(widgets.total?.rows.find((row) => row.method === "cash")?.billedCents).toBe(33_333);
  });

  it("tells whether the period has sales, for the billing and the sales tabs", async () => {
    const store = await proStore();
    expect((await billing(store.client)).hasActivity).toBe(false);
    expect((await report<SalesReport>(store.client, "sales", RANGE)).hasActivity).toBe(false);
    await seed(store, { date: "2026-06-02" });
    expect((await billing(store.client)).hasActivity).toBe(true);
    expect((await report<SalesReport>(store.client, "sales", RANGE)).hasActivity).toBe(true);
  });
});
