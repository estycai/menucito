import { describe, expect, it } from "vitest";
import type { CartLine } from "@menucito/shared";
import { buildManualOrderBody, shouldConfirmClose, type NewOrderFormValues } from "./new-order";

const values: NewOrderFormValues = {
  fulfillment: "takeaway",
  customerName: " Juan ",
  customerPhone: "11 5555-1234",
  address: "",
  source: "local",
  notes: "  timbre 2B  ",
  paymentMethod: "cash",
  splitCash: "",
  cashTendered: "",
  markPaid: false,
  tipCents: 0,
  whatsappConsent: false,
};

const line: CartLine = {
  key: "prod-1",
  productId: "prod-1",
  quantity: 2,
  choices: { Bacon: 2 },
  unitPriceCents: 100_000,
};

describe("15b: buildManualOrderBody", () => {
  it("builds the items and customer from the form and the cart", () => {
    const body = buildManualOrderBody({
      values,
      lines: [line],
      clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
      delivery: null,
      totalCents: 200_000,
      tipCents: 0,
      splitCashCents: null,
      cashTenderedCents: null,
    });
    expect(body.items).toEqual([{ productId: "prod-1", quantity: 2, choices: { Bacon: 2 } }]);
    expect(body.customer).toEqual({ name: "Juan", phone: "11 5555-1234" });
    expect(body.whatsappConsent).toBe(false);
    expect(body.notes).toBe("timbre 2B");
    expect(body.source).toBe("local");
    expect(body.expectedTotalCents).toBe(200_000);
    expect(body.paymentMethod).toBe("cash");
    expect("splitCashCents" in body).toBe(false);
  });

  it("sends the payment parts only when they apply", () => {
    const body = buildManualOrderBody({
      values: { ...values, paymentMethod: "split", splitCash: "1000", cashTendered: "2000" },
      lines: [line],
      clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
      delivery: null,
      totalCents: 300_000,
      tipCents: 0,
      splitCashCents: 100_000,
      cashTenderedCents: 200_000,
    });
    expect(body.splitCashCents).toBe(100_000);
    expect(body.cashTenderedCents).toBe(200_000);
  });

  it("sends the geocoded address of a zones delivery", () => {
    const delivery = {
      placeId: "place-1",
      lat: -34.6,
      lng: -58.4,
      formattedAddress: "Av. Corrientes 1234",
      locality: "CABA",
      unit: null,
      betweenStreets: null,
      label: null,
    };
    const body = buildManualOrderBody({
      values: { ...values, fulfillment: "delivery", address: "Av. Corrientes 1234" },
      lines: [line],
      clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
      delivery,
      totalCents: 300_000,
      tipCents: 0,
      splitCashCents: null,
      cashTenderedCents: null,
    });
    expect(body.delivery).toEqual(delivery);
    expect(body.customer.address).toBe("Av. Corrientes 1234");
  });
});

describe("15b: closing the popup", () => {
  it("asks only when there is at least one product", () => {
    expect(shouldConfirmClose([])).toBe(false);
    expect(shouldConfirmClose([line])).toBe(true);
  });
});
