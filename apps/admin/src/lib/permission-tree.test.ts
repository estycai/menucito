import { PERMISSION_SECTIONS, validatePermissions, type PermissionKey } from "@menucito/shared";
import { describe, expect, it } from "vitest";
import { sectionState, togglePermission } from "./permission-tree";

const section = (key: string) => PERMISSION_SECTIONS.find((candidate) => candidate.key === key)!;

describe("togglePermission", () => {
  it("checks a section on its own", () => {
    expect(togglePermission([], "orders.view")).toEqual(["orders.view"]);
  });

  it("checks the section when a sub-permission is checked", () => {
    expect(togglePermission([], "orders.payment")).toEqual(["orders.view", "orders.payment"]);
  });

  it("unchecks a sub-permission without touching its section", () => {
    expect(togglePermission(["orders.view", "orders.payment"], "orders.payment")).toEqual(["orders.view"]);
  });

  it("unchecks every sub-permission when the section is unchecked", () => {
    const selected: PermissionKey[] = ["orders.view", "orders.status", "orders.export", "menu.view"];
    expect(togglePermission(selected, "orders.view")).toEqual(["menu.view"]);
  });

  it("keeps the catalog order whatever order the user clicked in", () => {
    let selected: PermissionKey[] = [];
    selected = togglePermission(selected, "store.edit");
    selected = togglePermission(selected, "orders.export");
    selected = togglePermission(selected, "summary.view");
    expect(selected).toEqual(["summary.view", "orders.view", "orders.export", "store.view", "store.edit"]);
  });

  it("always yields a list the API accepts", () => {
    let selected: PermissionKey[] = [];
    for (const key of ["menu.edit", "orders.status", "store.view", "orders.view", "menu.view"] as const) {
      selected = togglePermission(selected, key);
      expect(validatePermissions(selected)).toBeNull();
    }
  });

  it("does not mutate the input", () => {
    const selected: PermissionKey[] = ["orders.view"];
    togglePermission(selected, "orders.status");
    expect(selected).toEqual(["orders.view"]);
  });
});

describe("sectionState", () => {
  it("counts the checked sub-permissions", () => {
    const state = sectionState(["orders.view", "orders.status", "orders.export"], section("orders.view"));
    expect(state).toEqual({ checked: true, checkedCount: 2, totalCount: 4, summary: "2 de 4" });
  });

  it("has no summary when no sub-permission is checked or the section has none", () => {
    expect(sectionState(["orders.view"], section("orders.view")).summary).toBeNull();
    expect(sectionState(["qr.view"], section("qr.view"))).toEqual({
      checked: true,
      checkedCount: 0,
      totalCount: 0,
      summary: null,
    });
  });

  it("reports an unchecked section", () => {
    expect(sectionState([], section("menu.view")).checked).toBe(false);
  });
});
