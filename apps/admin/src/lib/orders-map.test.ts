import { describe, expect, it } from "vitest";
import type { OrderSummary } from "@menucito/shared";
import {
  DEFAULT_MAP_FILTERS,
  filterMapOrders,
  mergeBoardOrders,
  splitByLocation,
  toggleStatus,
  zoneNamesOf,
  type MapFilters,
} from "./orders-map";

const order = (id: string, overrides: Partial<OrderSummary> = {}): OrderSummary =>
  ({
    id,
    number: Number(id.slice(1)),
    status: "new",
    fulfillment: "delivery",
    paymentMethod: "cash",
    deliveryLocation: null,
    ...overrides,
  }) as OrderSummary;

const at = (zoneName: string | null) => ({ lat: -34.6, lng: -58.4, zoneName });

const orders = [
  order("o1", { status: "new", deliveryLocation: at("Centro") }),
  order("o2", { status: "sent", paymentMethod: "transfer", deliveryLocation: at("Lejos") }),
  order("o3", { status: "ready", fulfillment: "takeaway" }),
  order("o4", { status: "delivered", deliveryLocation: at("Centro") }),
];
const ids = (list: OrderSummary[]) => list.map((o) => o.id);
const filters = (overrides: Partial<MapFilters>): MapFilters => ({ ...DEFAULT_MAP_FILTERS, ...overrides });

describe("filterMapOrders", () => {
  it("shows only active orders by default and the delivered ones too for today", () => {
    expect(ids(filterMapOrders(orders, DEFAULT_MAP_FILTERS))).toEqual(["o1", "o2", "o3"]);
    expect(ids(filterMapOrders(orders, filters({ scope: "today" })))).toEqual(["o1", "o2", "o3", "o4"]);
  });

  it("keeps any of the chosen statuses", () => {
    expect(ids(filterMapOrders(orders, filters({ statuses: ["new", "sent"] })))).toEqual(["o1", "o2"]);
    // A delivered status only matters for today.
    expect(ids(filterMapOrders(orders, filters({ statuses: ["delivered"] })))).toEqual([]);
    expect(ids(filterMapOrders(orders, filters({ statuses: ["delivered"], scope: "today" })))).toEqual(["o4"]);
  });

  it("filters by payment method and zone, leaving out orders without a zone", () => {
    expect(ids(filterMapOrders(orders, filters({ paymentMethod: "transfer" })))).toEqual(["o2"]);
    expect(ids(filterMapOrders(orders, filters({ zone: "Centro", scope: "today" })))).toEqual(["o1", "o4"]);
  });
});

describe("splitByLocation", () => {
  it("puts orders with a point on the map and the rest in the list", () => {
    const { mapped, unmapped } = splitByLocation(orders);
    expect(ids(mapped)).toEqual(["o1", "o2", "o4"]);
    expect(ids(unmapped)).toEqual(["o3"]);
  });
});

describe("zoneNamesOf", () => {
  it("lists each zone once, sorted, skipping orders without a zone", () => {
    expect(zoneNamesOf([...orders, order("o5", { deliveryLocation: at(null) })])).toEqual(["Centro", "Lejos"]);
  });
});

describe("toggleStatus", () => {
  it("adds a missing status and removes a present one", () => {
    expect(toggleStatus(["new"], "sent")).toEqual(["new", "sent"]);
    expect(toggleStatus(["new", "sent"], "new")).toEqual(["sent"]);
  });
});

describe("mergeBoardOrders", () => {
  it("keeps an order in both lists only once, as the active one", () => {
    const merged = mergeBoardOrders([order("o1")], [order("o1", { status: "delivered" }), order("o4")]);
    expect(merged.map((o) => [o.id, o.status])).toEqual([
      ["o1", "new"],
      ["o4", "new"],
    ]);
  });
});
