import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  effectivePermissions,
  normalizePermissions,
  parentOf,
  validatePermissions,
  type Access,
  type PermissionKey,
} from "./permissions";
import {
  GRANTED_REPORT_PERMISSION_KEYS,
  REPORT_PERMISSION_KEYS,
  REPORT_TABS,
  reportParentOf,
} from "./report-permissions";

describe("Reports permission catalog (16a)", () => {
  it("declares the 48 keys of the section and the 47 that migration 0017 grants", () => {
    expect(REPORT_PERMISSION_KEYS).toHaveLength(48);
    expect(GRANTED_REPORT_PERMISSION_KEYS).toHaveLength(47);
    expect(new Set(REPORT_PERMISSION_KEYS).size).toBe(48);
    for (const key of REPORT_PERMISSION_KEYS) expect(ALL_PERMISSIONS).toContain(key);
  });

  it("hangs every widget from its tab and everything else from stats.view", () => {
    expect(parentOf("stats.w.evolution.billed")).toBe("stats.tab.evolution");
    expect(parentOf("stats.w.sales.top")).toBe("stats.tab.sales");
    expect(parentOf("stats.tab.evolution")).toBe("stats.view");
    expect(parentOf("stats.f.date")).toBe("stats.view");
    expect(parentOf("stats.amounts")).toBe("stats.view");
    expect(parentOf("stats.view")).toBeNull();
    expect(parentOf("orders.payment")).toBe("orders.view");
    expect(reportParentOf("orders.payment")).toBeUndefined();
    expect(reportParentOf("stats.w.cash.kpis")).toBe("stats.tab.cash");
  });

  it("keeps the catalog order after normalizing", () => {
    expect(normalizePermissions(["stats.w.evolution.orders", "stats.view", "stats.tab.evolution", "ghost"])).toEqual([
      "stats.view",
      "stats.tab.evolution",
      "stats.w.evolution.orders",
    ]);
  });
});

describe("three-level validatePermissions", () => {
  it("names the tab of a widget without it", () => {
    expect(validatePermissions(["stats.view", "stats.w.evolution.billed"])).toMatchObject({
      permission: "stats.w.evolution.billed",
      missing: "stats.tab.evolution",
    });
  });

  it("names stats.view when the tab is there but the section is not", () => {
    expect(validatePermissions(["stats.tab.evolution", "stats.w.evolution.billed"])).toMatchObject({
      permission: "stats.tab.evolution",
      missing: "stats.view",
    });
  });

  it("accepts the whole chain and each level alone", () => {
    expect(validatePermissions(["stats.view"])).toBeNull();
    expect(validatePermissions(["stats.view", "stats.tab.evolution"])).toBeNull();
    expect(validatePermissions(["stats.view", "stats.tab.evolution", "stats.w.evolution.billed"])).toBeNull();
  });
});

describe("effectivePermissions", () => {
  const access = (permissions: PermissionKey[], overrides: Partial<Access> = {}): Access => ({
    memberId: "m1",
    isOwner: false,
    isCourier: false,
    active: true,
    role: { id: "r1", name: "Encargado", active: true },
    permissions,
    ...overrides,
  });

  it("drops a widget whose tab is missing", () => {
    const result = effectivePermissions(access(["stats.view", "stats.w.evolution.billed"]));
    expect(result).toEqual(["stats.view"]);
  });

  it("keeps the whole chain", () => {
    const result = effectivePermissions(
      access(["stats.view", "stats.tab.evolution", "stats.w.evolution.billed", "orders.view", "orders.status"]),
    );
    expect(result).toEqual(["orders.view", "orders.status", "stats.view", "stats.tab.evolution", "stats.w.evolution.billed"]);
  });

  it("gives the owner everything and an inactive member nothing", () => {
    expect(effectivePermissions(access([], { isOwner: true }))).toEqual([...ALL_PERMISSIONS]);
    expect(effectivePermissions(access(["stats.view"], { active: false }))).toEqual([]);
    expect(effectivePermissions(access(["stats.view"], { role: { id: "r", name: "R", active: false } }))).toEqual([]);
  });
});

describe("Reports tabs", () => {
  it("declares the 34 widgets over the five tabs", () => {
    expect(REPORT_TABS).toHaveLength(5);
    expect(REPORT_TABS.reduce((sum, tab) => sum + tab.widgets.length, 0)).toBe(34);
  });
});
