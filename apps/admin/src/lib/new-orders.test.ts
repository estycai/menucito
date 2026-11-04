import { describe, expect, it } from "vitest";
import { formatArs, type OrderSummary } from "@menucito/shared";
import { findNewOrders, newOrdersToast, ordersNavigationState } from "./new-orders";

const orders = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: Array<{ id: string }>) => list.map((order) => order.id);

describe("findNewOrders", () => {
  it("announces nothing on the first load, whatever is already there", () => {
    expect(findNewOrders(null, orders("a", "b"))).toEqual([]);
  });

  it("finds the first order arriving on an empty board (scenario 41)", () => {
    expect(ids(findNewOrders(new Set(), orders("a")))).toEqual(["a"]);
  });

  it("finds only ids that were not there before", () => {
    expect(ids(findNewOrders(new Set(["a", "b"]), orders("a", "b", "c", "d")))).toEqual(["c", "d"]);
  });

  it("does not count orders that left the board", () => {
    expect(findNewOrders(new Set(["a", "b"]), orders("b"))).toEqual([]);
  });
});

describe("newOrdersToast", () => {
  const order = (id: string, number: number): OrderSummary =>
    ({ id, number, customerName: "Juan", fulfillment: "delivery", totalCents: 1_050_000 }) as OrderSummary;

  it("shows one order with its customer, fulfillment and total, and opens it (spec 11b, scenario 19)", () => {
    expect(newOrdersToast([order("a", 12)])).toEqual({
      title: "Nuevo pedido #12",
      description: `Juan · Envío · ${formatArs(1_050_000)}`,
      actionLabel: "Ver pedido",
      target: { showActiveOrders: true, openOrderId: "a" },
    });
  });

  it("summarizes several orders of the same poll in a single toast", () => {
    expect(newOrdersToast([order("a", 12), order("b", 13), order("c", 14)])).toEqual({
      title: "Llegaron 3 pedidos nuevos",
      actionLabel: "Ver pedidos",
      target: { showActiveOrders: true },
    });
  });

  it("says nothing when there are no new orders", () => {
    expect(newOrdersToast([])).toBeNull();
  });
});

describe("ordersNavigationState", () => {
  it("accepts only the state a new-order toast sets", () => {
    const state = { showActiveOrders: true, openOrderId: "a" };
    expect(ordersNavigationState(state)).toBe(state);
    expect(ordersNavigationState({ showActiveOrders: true })).toEqual({ showActiveOrders: true });
    expect(ordersNavigationState(null)).toBeNull();
    expect(ordersNavigationState({ openOrderId: "a" })).toBeNull();
    expect(ordersNavigationState({ showActiveOrders: true, openOrderId: 3 })).toBeNull();
  });
});
