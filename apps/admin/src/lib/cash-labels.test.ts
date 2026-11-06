import { describe, expect, it } from "vitest";
import { courierPaymentLabel, movementMethodText } from "./cash-labels";

describe("movementMethodText", () => {
  it("names the method of a single-method movement", () => {
    expect(movementMethodText({ method: "cash", cashCents: 100_000, transferCents: 0, automatic: false })).toBe("Efectivo");
    expect(movementMethodText({ method: "transfer", cashCents: 0, transferCents: 100_000, automatic: false })).toBe(
      "Transferencia",
    );
  });

  it("shows both parts of a split movement", () => {
    expect(movementMethodText({ method: "split", cashCents: 200_000, transferCents: 100_000, automatic: false })).toBe(
      "Efectivo $2.000 + Transferencia $1.000",
    );
  });

  it("hides the method of an automatic income, whose comment already names it", () => {
    expect(movementMethodText({ method: "cash", cashCents: 500_000, transferCents: 0, automatic: true })).toBeNull();
  });
});

describe("courierPaymentLabel", () => {
  it("says who got the payment", () => {
    const courier = { memberId: "m1", firstName: "Juan", lastName: "Reparto" };
    expect(courierPaymentLabel({ courier, comment: "Envíos y propinas" })).toBe("Juan Reparto · Envíos y propinas");
    expect(courierPaymentLabel({ courier, comment: "" })).toBe("Juan Reparto");
  });
});
