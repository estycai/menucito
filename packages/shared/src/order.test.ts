import { describe, expect, it } from "vitest";
import {
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_MESSAGES,
  ORDER_NAME_MAX_LENGTH,
  orderDetailsErrors,
  orderDetailsSchema,
} from "./order";

const valid = { name: "Juan", fulfillment: "delivery", address: "Av. Siempre Viva 742", payment: "transfer" } as const;

describe("orderDetailsSchema (scenario 10)", () => {
  it("accepts delivery with an address and pickup without one", () => {
    expect(orderDetailsSchema.safeParse(valid).success).toBe(true);
    expect(orderDetailsSchema.safeParse({ ...valid, fulfillment: "takeaway", address: "" }).success).toBe(true);
  });

  it("trims the name and the address", () => {
    expect(orderDetailsSchema.parse({ ...valid, name: "  Juan  ", address: " Calle 1 " })).toMatchObject({
      name: "Juan",
      address: "Calle 1",
    });
  });

  it("requires the name and limits it to 60 characters", () => {
    expect(orderDetailsErrors({ ...valid, name: "   " }).name).toBe(ORDER_MESSAGES.nameRequired);
    expect(orderDetailsErrors({ ...valid, name: "a".repeat(ORDER_NAME_MAX_LENGTH + 1) }).name).toBe(
      ORDER_MESSAGES.nameTooLong,
    );
    expect(orderDetailsErrors({ ...valid, name: "a".repeat(ORDER_NAME_MAX_LENGTH) }).name).toBeUndefined();
  });

  it("requires the address only for delivery, and limits it to 120 characters", () => {
    expect(orderDetailsErrors({ ...valid, address: " " }).address).toBe(ORDER_MESSAGES.addressRequired);
    expect(orderDetailsErrors({ ...valid, fulfillment: "takeaway", address: "" })).toEqual({});
    expect(orderDetailsErrors({ ...valid, address: "a".repeat(ORDER_ADDRESS_MAX_LENGTH + 1) }).address).toBe(
      ORDER_MESSAGES.addressTooLong,
    );
  });

  it("requires a valid fulfillment and payment method", () => {
    expect(orderDetailsErrors({ ...valid, fulfillment: "" }).fulfillment).toBe(ORDER_MESSAGES.fulfillmentRequired);
    expect(orderDetailsErrors({ ...valid, payment: "" }).payment).toBe(ORDER_MESSAGES.paymentRequired);
    expect(orderDetailsErrors({ ...valid, payment: "bitcoin" }).payment).toBe(ORDER_MESSAGES.paymentRequired);
  });

  it("reports every error at once, including the address when another field is wrong", () => {
    expect(orderDetailsErrors({ name: "", fulfillment: "delivery", address: "", payment: "" })).toEqual({
      name: ORDER_MESSAGES.nameRequired,
      address: ORDER_MESSAGES.addressRequired,
      payment: ORDER_MESSAGES.paymentRequired,
    });
  });

  it("does not throw on input that is not an object", () => {
    expect(orderDetailsErrors(null)).toBeDefined();
    expect(orderDetailsErrors("x")).toBeDefined();
  });
});
