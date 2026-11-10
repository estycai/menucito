import { describe, expect, it } from "vitest";
import type { Access, EvolutionReport, PermissionKey } from "@menucito/shared";
import {
  canExport,
  canSeeAmounts,
  clipEvolutionReport,
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
