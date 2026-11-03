import { describe, expect, it } from "vitest";
import { countNewOrders, newOrdersMessage } from "./use-new-order-announcer";

const orders = (...ids: string[]) => ids.map((id) => ({ id }));

describe("countNewOrders", () => {
  it("announces nothing on the first load, whatever is already there", () => {
    expect(countNewOrders(null, orders("a", "b"))).toBe(0);
  });

  it("counts the first order arriving on an empty board (scenario 41)", () => {
    expect(countNewOrders(new Set(), orders("a"))).toBe(1);
  });

  it("counts only ids that were not there before", () => {
    expect(countNewOrders(new Set(["a", "b"]), orders("a", "b", "c", "d"))).toBe(2);
  });

  it("does not count orders that left the board", () => {
    expect(countNewOrders(new Set(["a", "b"]), orders("b"))).toBe(0);
  });
});

describe("newOrdersMessage", () => {
  it("uses the singular for one order and the plural otherwise", () => {
    expect(newOrdersMessage(1)).toBe("Llegó 1 pedido nuevo");
    expect(newOrdersMessage(3)).toBe("Llegaron 3 pedidos nuevos");
  });

  it("says nothing when there are no new orders", () => {
    expect(newOrdersMessage(0)).toBeNull();
  });
});
