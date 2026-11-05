import { describe, expect, it } from "vitest";
import type { OrderDetail, OrderSummary } from "@menucito/shared";
import { ApiError } from "./restaurant";
import {
  ACTIVE_ORDERS_KEY,
  ORDERS_BACKGROUND_POLL_MS,
  ORDERS_POLL_MS,
  ordersPollInterval,
  DELIVERED_TODAY_FILTERS,
  DELIVERED_TODAY_KEY,
  adjacentColumn,
  applyAssignment,
  buildQueryString,
  dropTargetsFor,
  filtersFromSearchParams,
  filtersToSearchParams,
  exportErrorFrom,
  googleMapsSearchUrl,
  isExportTooLargeError,
  isInvalidTransitionError,
  isValidDrop,
  moveOrder,
  revertOrder,
  ordersPath,
  resolvePresetDates,
  type BoardPages,
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
    expect(dropTargetsFor("new", "delivery")).toEqual(["preparing", "ready", "delivered"]);
    expect(dropTargetsFor("preparing", "delivery")).toEqual(["ready", "delivered"]);
    expect(dropTargetsFor("ready", "delivery")).toEqual(["sent", "delivered"]);
    expect(dropTargetsFor("sent", "delivery")).toEqual(["delivered"]);
    expect(dropTargetsFor("delivered", "delivery")).toEqual([]);
    expect(dropTargetsFor("cancelled", "delivery")).toEqual([]);
  });

  it("only sends a Ready order, through assignment (13 scenarios 39 and 41)", () => {
    // Enviados is not a step that can be skipped: it is reached by assigning a courier to a Ready order.
    expect(isValidDrop("new", "delivery", "sent")).toBe(false);
    expect(isValidDrop("preparing", "delivery", "sent")).toBe(false);
    expect(isValidDrop("ready", "delivery", "sent")).toBe(true);
    // Without `orders.assign`, Enviados is not a valid destination at all.
    expect(dropTargetsFor("ready", "delivery", { canAssign: false })).toEqual(["delivered"]);
    expect(isValidDrop("ready", "delivery", "sent", { canAssign: false })).toBe(false);
    // A member without `orders.status` can still assign, but cannot move to the other columns.
    expect(dropTargetsFor("ready", "delivery", { canChangeStatus: false })).toEqual(["sent"]);
    expect(isValidDrop("new", "delivery", "preparing", { canChangeStatus: false })).toBe(false);
  });

  it("never offers Enviados to a takeaway order (spec 11b, scenario 14)", () => {
    expect(dropTargetsFor("new", "takeaway")).toEqual(["preparing", "ready", "delivered"]);
    expect(dropTargetsFor("preparing", "takeaway")).toEqual(["ready", "delivered"]);
    expect(dropTargetsFor("ready", "takeaway")).toEqual(["delivered"]);
    expect(isValidDrop("ready", "takeaway", "sent")).toBe(false);
    expect(isValidDrop("ready", "delivery", "sent")).toBe(true);
  });

  it("accepts a drop only on a forward board column", () => {
    expect(isValidDrop("new", "delivery", "preparing")).toBe(true);
    expect(isValidDrop("new", "delivery", "ready")).toBe(true);
    expect(isValidDrop("preparing", "delivery", "ready")).toBe(true);
    expect(isValidDrop("new", "takeaway", "delivered")).toBe(true);
    expect(isValidDrop("ready", "takeaway", "delivered")).toBe(true);
    expect(isValidDrop("sent", "delivery", "delivered")).toBe(true);
    // Same column, backwards, off the board or not a column at all
    expect(isValidDrop("preparing", "delivery", "preparing")).toBe(false);
    expect(isValidDrop("ready", "delivery", "new")).toBe(false);
    expect(isValidDrop("sent", "delivery", "ready")).toBe(false);
    expect(isValidDrop("preparing", "delivery", "new")).toBe(false);
    expect(isValidDrop("new", "delivery", "cancelled")).toBe(false);
    expect(isValidDrop("new", "delivery", null)).toBe(false);
    expect(isValidDrop("new", "delivery", "order-1")).toBe(false);
  });

  it("walks the columns with the arrow keys and stops at the ends", () => {
    expect(adjacentColumn("new", 1)).toBe("preparing");
    expect(adjacentColumn("preparing", 1)).toBe("ready");
    expect(adjacentColumn("ready", 1)).toBe("sent");
    expect(adjacentColumn("sent", 1)).toBe("delivered");
    expect(adjacentColumn("delivered", 1)).toBeNull();
    expect(adjacentColumn("delivered", -1)).toBe("sent");
    expect(adjacentColumn("preparing", -1)).toBe("new");
    expect(adjacentColumn("new", -1)).toBeNull();
    expect(adjacentColumn(undefined, 1)).toBeNull();
  });
});

describe("delivered today query", () => {
  it("asks for the orders delivered (delivered_at) today, at most 50 (13 scenario 43)", () => {
    const path = ordersPath(DELIVERED_TODAY_FILTERS);
    expect(path).toMatch(
      /^\/api\/orders\?status=delivered&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&dateField=delivered&limit=50$/,
    );
    expect(DELIVERED_TODAY_KEY).not.toEqual(ACTIVE_ORDERS_KEY);
  });
});

describe("moveOrder", () => {
  const order = (id: string, number: number, status: OrderSummary["status"]) => ({ id, number, status }) as OrderSummary;
  const active: OrdersPage = { orders: [order("a", 3, "new"), order("b", 2, "preparing")], nextBefore: null };
  const delivered: OrdersPage = { orders: [order("c", 4, "delivered"), order("d", 1, "delivered")], nextBefore: null };
  const pages: BoardPages = { active, delivered };

  it("moves the order to another column keeping the list order", () => {
    const moved = moveOrder(pages, "a", "sent");
    expect(moved.active?.orders.map((o) => [o.id, o.status])).toEqual([
      ["a", "sent"],
      ["b", "preparing"],
    ]);
    expect(moved.delivered).toBe(delivered);
    // The cached page is not mutated: it is the rollback value
    expect(active.orders[0]!.status).toBe("new");
  });

  it("moves a delivered order to Entregados, newest first (spec 11b, scenario 15)", () => {
    const moved = moveOrder(pages, "b", "delivered");
    expect(moved.active?.orders.map((o) => o.id)).toEqual(["a"]);
    expect(moved.delivered?.orders.map((o) => [o.id, o.status])).toEqual([
      ["c", "delivered"],
      ["b", "delivered"],
      ["d", "delivered"],
    ]);
    expect(delivered.orders).toHaveLength(2);
  });

  it("does not cap Entregados optimistically: the refetch trims it", () => {
    const full: OrdersPage = {
      orders: Array.from({ length: 50 }, (_, i) => order(`d${i}`, 100 + i, "delivered")),
      nextBefore: null,
    };
    const moved = moveOrder({ active, delivered: full }, "a", "delivered");
    expect(moved.delivered?.orders).toHaveLength(51);
    expect(moved.delivered?.orders.some((o) => o.id === "a")).toBe(true);
  });

  it("starts Entregados with the moved order when it has not loaded yet", () => {
    const moved = moveOrder({ active, delivered: undefined }, "b", "delivered");
    expect(moved.delivered).toEqual({ orders: [{ ...order("b", 2, "preparing"), status: "delivered" }], nextBefore: null });
  });

  it("takes the order off the board once it is cancelled", () => {
    const moved = moveOrder(pages, "a", "cancelled");
    expect(moved.active?.orders.map((o) => o.id)).toEqual(["b"]);
    expect(moved.delivered).toBe(delivered);
  });

  it("leaves the pages untouched when the order is not on the active list or there is no list yet", () => {
    expect(moveOrder(pages, "zzz", "ready")).toBe(pages);
    const empty: BoardPages = { active: undefined, delivered: undefined };
    expect(moveOrder(empty, "a", "ready")).toBe(empty);
  });
});

describe("revertOrder", () => {
  const order = (id: string, number: number, status: OrderSummary["status"]) => ({ id, number, status }) as OrderSummary;

  it("puts back only the failed order, keeping another order moved meanwhile", () => {
    const start: BoardPages = {
      active: { orders: [order("a", 3, "new"), order("b", 2, "new"), order("c", 1, "ready")], nextBefore: null },
      delivered: { orders: [], nextBefore: null },
    };
    // "a" goes to Entregados and fails; "c" goes to Enviados and succeeds.
    const afterBoth = moveOrder(moveOrder(start, "a", "delivered"), "c", "sent");
    const reverted = revertOrder(afterBoth, order("a", 3, "new"));

    expect(reverted.active?.orders.map((o) => [o.id, o.status])).toEqual([
      ["a", "new"],
      ["b", "new"],
      ["c", "sent"],
    ]);
    expect(reverted.delivered?.orders).toEqual([]);
  });
});

describe("applyAssignment (13 scenario 39)", () => {
  const courier = { memberId: "m1", firstName: "Ana", lastName: "Gómez" };
  const summary = (id: string, number: number, status: OrderSummary["status"]) => ({ id, number, status }) as OrderSummary;
  const detail = (id: string, status: OrderDetail["status"]) =>
    ({ id, number: 1, status, courier }) as OrderDetail;
  const start: BoardPages = {
    active: { orders: [summary("a", 2, "ready"), summary("b", 1, "sent")], nextBefore: null },
    delivered: { orders: [], nextBefore: null },
  };

  it("shows the courier and sends a Ready order to Enviados without reloading", () => {
    const next = applyAssignment(start, detail("a", "sent"));
    expect(next.active?.orders.find((o) => o.id === "a")).toMatchObject({ status: "sent", courier });
    // The other order keeps its own state.
    expect(next.active?.orders.find((o) => o.id === "b")).toEqual(summary("b", 1, "sent"));
  });

  it("keeps a sent order in place and only changes its courier (reassignment)", () => {
    const next = applyAssignment(start, detail("b", "sent"));
    expect(next.active?.orders.find((o) => o.id === "b")).toMatchObject({ status: "sent", courier });
  });

  it("leaves the board untouched when the order is not on the active list", () => {
    expect(applyAssignment(start, detail("zzz", "sent"))).toBe(start);
    const empty: BoardPages = { active: undefined, delivered: undefined };
    expect(applyAssignment(empty, detail("a", "sent"))).toBe(empty);
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

describe("isExportTooLargeError", () => {
  it("recognizes only the too-many-orders code, not any 422 or a network error", () => {
    expect(isExportTooLargeError(new ApiError(422, "EXPORT_TOO_LARGE", "x"))).toBe(true);
    expect(isExportTooLargeError(new ApiError(422, "VALIDATION_ERROR", "x"))).toBe(false);
    expect(isExportTooLargeError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isExportTooLargeError(undefined)).toBe(false);
  });
});

describe("exportErrorFrom", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("reads the code from the JSON body", async () => {
    const err = await exportErrorFrom(json(422, { error: { code: "EXPORT_TOO_LARGE", message: "Too many" } }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("EXPORT_TOO_LARGE");
    expect(isExportTooLargeError(err)).toBe(true);
  });

  it("keeps other 422 codes apart from the too-many case", async () => {
    const err = await exportErrorFrom(json(422, { error: { code: "VALIDATION_ERROR", message: "Bad dates" } }));
    expect(isExportTooLargeError(err)).toBe(false);
  });

  it("falls back to UNKNOWN when the body is not JSON", async () => {
    const err = await exportErrorFrom(new Response("<html>", { status: 502 }));
    expect(err.status).toBe(502);
    expect(err.code).toBe("UNKNOWN");
  });
});

describe("googleMapsSearchUrl", () => {
  it("links to a search of the coordinates", () => {
    expect(googleMapsSearchUrl({ lat: -34.6037, lng: -58.3816 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=-34.6037,-58.3816",
    );
  });
});

describe("ordersPollInterval", () => {
  it("polls fast with the tab visible and keeps listening slower when hidden", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    try {
      Object.defineProperty(globalThis, "document", { value: { visibilityState: "visible" }, configurable: true });
      expect(ordersPollInterval()).toBe(ORDERS_POLL_MS);
      Object.defineProperty(globalThis, "document", { value: { visibilityState: "hidden" }, configurable: true });
      expect(ordersPollInterval()).toBe(ORDERS_BACKGROUND_POLL_MS);
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
      else delete (globalThis as { document?: unknown }).document;
    }
  });
});
