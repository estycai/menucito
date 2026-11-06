import { describe, expect, it } from "vitest";
import { filterByFulfillment } from "./orders";
import {
  ORDERS_FULFILLMENT_PARAM,
  ORDERS_INDIVIDUAL_VIEW,
  ORDERS_MAP_VIEW,
  ORDERS_VIEW_PARAM,
  parseFulfillmentMode,
  parseOrdersView,
} from "./orders-map";

describe("15a: filterByFulfillment", () => {
  const orders = [
    { id: "1", fulfillment: "delivery" as const },
    { id: "2", fulfillment: "takeaway" as const },
    { id: "3", fulfillment: "delivery" as const },
  ];

  it("keeps everything for Todos", () => {
    expect(filterByFulfillment(orders, null)).toEqual(orders);
  });

  it("keeps only the chosen fulfillment", () => {
    expect(filterByFulfillment(orders, "delivery").map((order) => order.id)).toEqual(["1", "3"]);
    expect(filterByFulfillment(orders, "takeaway").map((order) => order.id)).toEqual(["2"]);
  });
});

describe("15a: URL params", () => {
  it("reads vista as mapa, individual or the board", () => {
    expect(parseOrdersView(ORDERS_MAP_VIEW)).toBe("map");
    expect(parseOrdersView(ORDERS_INDIVIDUAL_VIEW)).toBe("individual");
    expect(parseOrdersView(null)).toBe("board");
    expect(parseOrdersView("otra")).toBe("board");
  });

  it("reads modo as delivery, takeaway or Todos", () => {
    expect(parseFulfillmentMode("delivery")).toBe("delivery");
    expect(parseFulfillmentMode("takeaway")).toBe("takeaway");
    expect(parseFulfillmentMode(null)).toBeNull();
    expect(parseFulfillmentMode("raro")).toBeNull();
  });

  it("uses the documented parameter names", () => {
    expect(ORDERS_VIEW_PARAM).toBe("vista");
    expect(ORDERS_FULFILLMENT_PARAM).toBe("modo");
  });
});
