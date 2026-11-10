import { describe, expect, it } from "vitest";
import type { Access, BillingReport, CashReport, CouriersReport, EvolutionReport, PermissionKey, SalesReport } from "@menucito/shared";
import {
  canExport,
  canSeeAmounts,
  canSeeCashExpected,
  clipBillingReport,
  clipCashReport,
  clipCouriersReport,
  clipEvolutionReport,
  clipSalesReport,
  filtersForAccess,
  reportViewSummary,
  simulatedAccess,
  toggleReportView,
  visibleFilters,
  visibleTabs,
  visibleWidgets,
} from "./report-access";

const access = (permissions: PermissionKey[]): Access => ({
  memberId: "m1",
  isOwner: false,
  isCourier: false,
  active: true,
  role: { id: "r1", name: "Encargado", active: true },
  permissions,
});

const FULL: PermissionKey[] = ["stats.view", "stats.tab.evolution", "stats.w.evolution.orders", "stats.w.evolution.billed"];

describe("report access helpers", () => {
  it("lists the visible tabs and filters", () => {
    expect(visibleTabs(access(FULL))).toEqual(["stats.tab.evolution"]);
    expect(visibleTabs(access(["stats.view"]))).toEqual([]);
    expect(visibleFilters(access([...FULL, "stats.f.date", "stats.f.courier"]))).toEqual(["stats.f.date", "stats.f.courier"]);
  });

  it("drops a widget whose tab is not visible", () => {
    expect(visibleWidgets(access(FULL), "stats.tab.evolution")).toEqual([
      "stats.w.evolution.billed",
      "stats.w.evolution.orders",
    ]);
    expect(visibleWidgets(access(["stats.view", "stats.w.evolution.orders"]), "stats.tab.evolution")).toEqual([]);
  });

  it("reads the amounts and export switches", () => {
    expect(canSeeAmounts(access([...FULL, "stats.amounts"]))).toBe(true);
    expect(canSeeAmounts(access(FULL))).toBe(false);
    expect(canExport(access([...FULL, "stats.export"]))).toBe(true);
    expect(canExport(access(FULL))).toBe(false);
  });

  it("previews a role with a draft without signing in as it", () => {
    const preview = simulatedAccess({ id: "r1", name: "Encargado" }, FULL);
    expect(preview).toMatchObject({
      isOwner: false,
      active: true,
      role: { id: "r1", name: "Encargado", active: true },
      permissions: FULL,
    });
    expect(visibleTabs(preview)).toEqual(["stats.tab.evolution"]);
  });

  it("drops the filters the role lacks from the request", () => {
    const role = access([...FULL, "stats.f.date", "stats.f.source"]);
    expect(
      filtersForAccess(role, {
        from: "2026-11-01",
        to: "2026-11-10",
        fulfillment: "delivery",
        source: "local",
        payment: "cash",
      }),
    ).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
      shift: undefined,
      fulfillment: undefined,
      payment: undefined,
      source: "local",
      courier: undefined,
    });
  });

  it("clips the owner's report to the widgets and cents of the role", () => {
    const report = {
      range: { from: "2026-11-01", to: "2026-11-10" },
      previousRange: { from: "2026-10-22", to: "2026-10-31" },
      widgets: {
        billed: { currentCents: 100_000, previousCents: 50_000, changePercent: 100 },
        orders: { current: 2, previous: 1, changePercent: 100 },
        payment_methods: {
          note: "nota",
          rows: [
            { method: "cash", orders: 1, billedCents: 70_000, percent: 70 },
            { method: "transfer", orders: 1, billedCents: 30_000, percent: 30 },
          ],
        },
      },
    } as EvolutionReport;
    const clipped = clipEvolutionReport(report, access([...FULL, "stats.w.evolution.payment_methods"]));
    expect(Object.keys(clipped.widgets).sort()).toEqual(["billed", "orders", "payment_methods"]);
    expect(clipped.widgets.payment_methods?.rows).toEqual([
      { method: "cash", orders: 1, percent: 50 },
      { method: "transfer", orders: 1, percent: 50 },
    ]);
    expect(JSON.stringify(clipped)).not.toContain("Cents");
  });
});

describe("toggleReportView (Configurar vista eyes)", () => {
  const base: PermissionKey[] = ["stats.view", "stats.tab.evolution", "stats.w.evolution.orders"];

  it("hides a tab with its blocks and shows them all again when none was left", () => {
    const hidden = toggleReportView(base, "stats.tab.evolution");
    expect(hidden).toEqual(["stats.view"]);
    const shown = toggleReportView(hidden, "stats.tab.evolution");
    expect(shown).toContain("stats.w.evolution.billed");
    expect(shown.filter((key) => key.startsWith("stats.w.evolution."))).toHaveLength(13);
  });

  it("keeps the chosen blocks when the tab still has some", () => {
    const withTab: PermissionKey[] = ["stats.view", "stats.tab.billing", "stats.w.billing.total"];
    expect(toggleReportView(withTab, "stats.w.billing.total")).toEqual(["stats.view", "stats.tab.billing"]);
    expect(toggleReportView(base, "stats.f.date")).toEqual([...base.slice(0, 1), "stats.f.date", ...base.slice(1)]);
  });

  it("counts tabs, filters and the blocks of the chosen tab", () => {
    expect(reportViewSummary(base, "stats.tab.evolution")).toEqual({
      tabs: { on: 1, total: 5 },
      filters: { on: 0, total: 6 },
      widgets: { on: 1, total: 13 },
    });
    expect(reportViewSummary(["stats.view"], "stats.tab.evolution").widgets.on).toBe(0);
  });
});

describe("clipBillingReport and clipSalesReport (Configurar vista preview)", () => {
  const range = { from: "2026-06-01", to: "2026-06-30" };
  const billing: BillingReport = {
    range,
    hasActivity: true,
    widgets: {
      total: {
        billedCents: 100_000,
        orders: 3,
        rows: [
          { method: "cash", orders: 2, billedCents: 30_000, percent: 30 },
          { method: "transfer", orders: 2, billedCents: 70_000, percent: 70 },
        ],
      },
      source: [
        { source: "web", orders: 3, ticketCents: 10_000, billedCents: 90_000, percent: 90 },
        { source: "local", orders: 1, ticketCents: 10_000, billedCents: 10_000, percent: 10 },
        { source: "whatsapp", orders: 0, ticketCents: 0, billedCents: 0, percent: 0 },
      ],
    },
  };
  const sales: SalesReport = {
    range,
    hasActivity: true,
    widgets: {
      top: { byUnits: [{ name: "Pizza", units: 3, revenueCents: 30_000 }], byRevenue: [{ name: "Pizza", units: 3, revenueCents: 30_000 }] },
      categories: {
        rows: [
          { category: "Pizzas", products: 1, units: 1, revenueCents: 90_000, percent: 90 },
          { category: "Bebidas", products: 1, units: 3, revenueCents: 10_000, percent: 10 },
        ],
        total: { category: "Total", products: 2, units: 4, revenueCents: 100_000, percent: 100 },
      },
      products: [],
    },
  };

  it("keeps only the role's blocks and, without amounts, percentages over orders and no cents", () => {
    const role = access(["stats.view", "stats.tab.billing", "stats.w.billing.total"]);
    const clipped = clipBillingReport(billing, role);
    expect(Object.keys(clipped.widgets)).toEqual(["total"]);
    expect(clipped.widgets.total?.rows.map((row) => row.percent)).toEqual([50, 50]);
    expect(JSON.stringify(clipped)).not.toContain("Cents");
    expect(clipped.hasActivity).toBe(true);
  });

  it("drops the revenue order and ranks the categories by units without amounts", () => {
    const role = access(["stats.view", "stats.tab.sales", "stats.w.sales.top", "stats.w.sales.categories"]);
    const clipped = clipSalesReport(sales, role);
    expect(clipped.widgets.top?.byRevenue).toBeUndefined();
    expect(clipped.widgets.categories?.rows.map((row) => [row.category, row.percent])).toEqual([
      ["Bebidas", 75],
      ["Pizzas", 25],
    ]);
    expect(clipped.widgets.products).toBeUndefined();
    expect(JSON.stringify(clipped)).not.toContain("Cents");
  });
});

describe("clipCouriersReport and clipCashReport (16c preview)", () => {
  const range = { from: "2026-06-01", to: "2026-06-30" };

  it("keeps the courier blocks of the role and hides the cents without amounts", () => {
    const report: CouriersReport = {
      range,
      previousRange: { from: "2026-05-02", to: "2026-05-31" },
      hasActivity: true,
      widgets: {
        orders: { current: 2, previous: 1, changePercent: 100 },
        shipping: { currentCents: 10_000, previousCents: 5_000, changePercent: 100 },
      },
    };
    const role = access(["stats.view", "stats.tab.couriers", "stats.w.couriers.orders"]);
    const clipped = clipCouriersReport(report, role);
    expect(Object.keys(clipped.widgets)).toEqual(["orders"]);
    expect(clipped.widgets.shipping).toBeUndefined();
  });

  it("applies the blind close of Cajas to the preview", () => {
    const report: CashReport = {
      range,
      hasActivity: true,
      widgets: {
        kpis: {
          sessions: 1,
          closed: 1,
          inProgress: 0,
          salesCents: 100_000,
          orders: 1,
          incomeCents: 0,
          expenseCents: 0,
          differenceCents: 0,
          expectedCents: 100_000,
          countedCents: 100_000,
          balanced: 1,
        },
        by_method: {
          rows: [
            { method: "cash", orders: 1, salesCents: 70_000, percent: 70, incomeCents: 0, expenseCents: 0 },
            { method: "transfer", orders: 1, salesCents: 30_000, percent: 30, incomeCents: 0, expenseCents: 0 },
          ],
          total: { orders: 2, salesCents: 100_000, percent: 100, incomeCents: 0, expenseCents: 0 },
        },
        sessions: [
          {
            id: "s1",
            openedAt: 0,
            closedAt: 1_000,
            shift: "off",
            shiftLabel: "Fuera de horario",
            openedByName: "Ana",
            closedByName: "Ana",
            orders: 1,
            salesCents: 100_000,
            expenseCents: 0,
            expectedCashCents: 100_000,
            countedCashCents: 100_000,
            differenceCents: 0,
          },
        ],
      },
    };
    const blind = access(["stats.view", "stats.tab.cash", "stats.w.cash.kpis", "stats.w.cash.by_method", "stats.w.cash.sessions", "stats.amounts"]);
    expect(canSeeCashExpected(blind)).toBe(false);
    const clipped = clipCashReport(report, blind);
    expect(clipped.widgets.kpis?.salesCents).toBe(100_000);
    expect(clipped.widgets.kpis).not.toHaveProperty("expectedCents");
    expect(clipped.widgets.kpis).not.toHaveProperty("differenceCents");
    expect(clipped.widgets.sessions?.[0]).not.toHaveProperty("countedCashCents");
    expect(clipped.widgets.sessions?.[0]).not.toHaveProperty("differenceCents");

    const withoutAmounts = clipCashReport(report, access(["stats.view", "stats.tab.cash", "stats.w.cash.by_method"]));
    expect(withoutAmounts.widgets.by_method?.rows.map((row) => row.percent)).toEqual([50, 50]);
    expect(withoutAmounts.widgets.by_method?.rows[0]).not.toHaveProperty("salesCents");
  });
});
