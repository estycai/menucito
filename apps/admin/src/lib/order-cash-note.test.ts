import { describe, expect, it } from "vitest";
import { orderCashNote } from "./order-cash-note";

const base = {
  status: "delivered",
  fulfillment: "delivery",
  paymentMethod: "cash",
  paymentStatus: "paid",
  paidAt: Date.UTC(2026, 10, 5, 23, 0),
  updatedAt: Date.UTC(2026, 10, 5, 23, 0),
  cashSessionId: null,
  settledAt: null,
  courier: { memberId: "m1", firstName: "Juan", lastName: "Reparto" },
} as const;

describe("orderCashNote", () => {
  it("says a delivered cash or split order is still with the courier until it is entered", () => {
    expect(orderCashNote(base)).toBe("A ingresar a la caja · lo tiene Juan");
    expect(orderCashNote({ ...base, paymentMethod: "split" })).toBe("A ingresar a la caja · lo tiene Juan");
  });

  it("says when it was entered once the courier handed the cash in", () => {
    expect(orderCashNote({ ...base, cashSessionId: "s1", settledAt: base.paidAt })).toMatch(/^Ingresado a la caja el /);
  });

  it("tells paid in a cash session apart from paid without one", () => {
    const takeaway = { ...base, fulfillment: "takeaway", status: "new" } as const;
    expect(orderCashNote({ ...takeaway, cashSessionId: "s1" })).toMatch(/^Cobrado el /);
    expect(orderCashNote(takeaway)).toBe("Cobrado sin caja abierta");
    expect(orderCashNote({ ...base, paymentMethod: "transfer" })).toBe("Cobrado sin caja abierta");
  });

  it("has no line for an unpaid order", () => {
    expect(orderCashNote({ ...base, paymentStatus: "pending" })).toBeNull();
  });
});
