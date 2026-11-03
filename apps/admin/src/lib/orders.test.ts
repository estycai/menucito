import { describe, expect, it } from "vitest";
import type { OrderSummary } from "@menucito/shared";
import { ApiError } from "./restaurant";
import {
  adjacentColumn,
  buildQueryString,
  dropTargetsFor,
  filtersFromSearchParams,
  filtersToSearchParams,
  isInvalidTransitionError,
  isValidDrop,
  moveOrder,
  ordersPath,
  resolvePresetDates,
  type OrderFilters,
  type OrdersPage,
} from "./orders";

describe("resolvePresetDates", () => {
  // 2026-11-02 12:00:00 UTC = 2026-11-02 09:00 in Buenos Aires
  const fixedNov2Ms = new Date("2026-11-02T12:00:00Z").getTime();

  it("resolves today preset to current local day", () => {
    const dates = resolvePresetDates("today", fixedNov2Ms);
    expect(dates.from).toBe("2026-11-02");
    expect(dates.to).toBe("2026-11-02");
  });

  it("resolves 7d preset to 6 days ago through today (7 days inclusive)", () => {
    const dates = resolvePresetDates("7d", fixedNov2Ms);
    expect(dates.from).toBe("2026-10-27");
    expect(dates.to).toBe("2026-11-02");
  });

  it("resolves 30d preset to 29 days ago through today (30 days inclusive)", () => {
    const dates = resolvePresetDates("30d", fixedNov2Ms);
    expect(dates.from).toBe("2026-10-04");
    expect(dates.to).toBe("2026-11-02");
  });
});

describe("filters search params serialization and parsing", () => {
  it("round-trips filters to and from URLSearchParams", () => {
    const filters: OrderFilters = {
      status: "active",
      fulfillment: "delivery",
      paymentMethod: "cash",
      paymentStatus: "pending",
      preset: "today",
    };

    const params = filtersToSearchParams(filters);
    expect(params.get("status")).toBe("active");
    expect(params.get("fulfillment")).toBe("delivery");
    expect(params.get("paymentMethod")).toBe("cash");
    expect(params.get("paymentStatus")).toBe("pending");
    expect(params.get("preset")).toBe("today");
    expect(params.has("before")).toBe(false);

    const parsed = filtersFromSearchParams(params);
    expect(parsed).toEqual(filters);
  });
});

describe("buildQueryString", () => {
  it("resolves preset to from/to query params", () => {
    const qs = buildQueryString({ preset: "today", status: "active" });
    expect(qs).toContain("status=active");
    expect(qs).toContain("from=");
    expect(qs).toContain("to=");
  });

  it("passes custom from/to params directly", () => {
    const qs = buildQueryString({ preset: "custom", from: "2026-11-01", to: "2026-11-05" });
    expect(qs).toContain("from=2026-11-01");
    expect(qs).toContain("to=2026-11-05");
  });
});

describe("pagination cursor", () => {
  it("is never read from nor written to the URL", () => {
    const parsed = filtersFromSearchParams(new URLSearchParams("status=new&before=42"));
    expect(parsed).toEqual({ status: "new" });
    expect(filtersToSearchParams(parsed).has("before")).toBe(false);
  });

  it("goes only in the list query of a following page, never in the export query", () => {
    const filters: OrderFilters = { status: "delivered" };
    expect(ordersPath(filters)).toBe("/api/orders?status=delivered");
    expect(ordersPath(filters, 42)).toBe("/api/orders?status=delivered&before=42");
    expect(buildQueryString(filters)).toBe("status=delivered");
  });
});

describe("board drag and drop", () => {
  it("offers only the columns ahead of the order (no going back)", () => {
    expect(dropTargetsFor("new")).toEqual(["preparing", "ready", "delivered"]);
    expect(dropTargetsFor("preparing")).toEqual(["ready", "delivered"]);
    expect(dropTargetsFor("ready")).toEqual(["delivered"]);
    expect(dropTargetsFor("delivered")).toEqual([]);
    expect(dropTargetsFor("cancelled")).toEqual([]);
  });

  it("accepts a drop only on a forward board column", () => {
    expect(isValidDrop("new", "preparing")).toBe(true);
    expect(isValidDrop("new", "ready")).toBe(true);
    expect(isValidDrop("preparing", "ready")).toBe(true);
    expect(isValidDrop("new", "delivered")).toBe(true);
    expect(isValidDrop("ready", "delivered")).toBe(true);
    // Same column, backwards, off the board or not a column at all
    expect(isValidDrop("preparing", "preparing")).toBe(false);
    expect(isValidDrop("ready", "new")).toBe(false);
    expect(isValidDrop("preparing", "new")).toBe(false);
    expect(isValidDrop("new", "cancelled")).toBe(false);
    expect(isValidDrop("new", null)).toBe(false);
    expect(isValidDrop("new", "order-1")).toBe(false);
  });

  it("walks the columns with the arrow keys and stops at the ends", () => {
    expect(adjacentColumn("new", 1)).toBe("preparing");
    expect(adjacentColumn("preparing", 1)).toBe("ready");
    expect(adjacentColumn("ready", 1)).toBe("delivered");
    expect(adjacentColumn("delivered", 1)).toBeNull();
    expect(adjacentColumn("preparing", -1)).toBe("new");
    expect(adjacentColumn("new", -1)).toBeNull();
    expect(adjacentColumn(undefined, 1)).toBeNull();
  });
});

describe("moveOrder", () => {
  const order = (id: string, status: OrderSummary["status"]) => ({ id, status }) as OrderSummary;
  const page: OrdersPage = { orders: [order("a", "new"), order("b", "preparing")], nextBefore: null };

  it("moves the order to another column keeping the list order", () => {
    const moved = moveOrder(page, "a", "ready");
    expect(moved?.orders.map((o) => [o.id, o.status])).toEqual([
      ["a", "ready"],
      ["b", "preparing"],
    ]);
    // The cached page is not mutated: it is the rollback value
    expect(page.orders[0]!.status).toBe("new");
  });

  it("takes the order off the board once it is delivered or cancelled", () => {
    expect(moveOrder(page, "b", "delivered")?.orders.map((o) => o.id)).toEqual(["a"]);
    expect(moveOrder(page, "a", "cancelled")?.orders.map((o) => o.id)).toEqual(["b"]);
  });

  it("leaves the page untouched when the order is not on it or there is no page yet", () => {
    expect(moveOrder(page, "zzz", "ready")).toBe(page);
    expect(moveOrder(undefined, "a", "ready")).toBeUndefined();
  });
});

describe("isInvalidTransitionError", () => {
  it("recognizes the 409 of a status that changed meanwhile", () => {
    expect(isInvalidTransitionError(new ApiError(409, "INVALID_TRANSITION", "x"))).toBe(true);
    expect(isInvalidTransitionError(new ApiError(500, "INTERNAL", "x"))).toBe(false);
    expect(isInvalidTransitionError(new Error("network"))).toBe(false);
    expect(isInvalidTransitionError(null)).toBe(false);
  });
});
