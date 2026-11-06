import { describe, expect, it } from "vitest";
import {
  MANUAL_ORDER_SOURCES,
  ORDER_NOTES_MAX_LENGTH,
  ORDER_SOURCES,
  ORDER_SOURCE_LABELS,
  createManualOrderRequestSchema,
} from "./orders";

const validOrder = {
  items: [{ productId: "prod-1", quantity: 1 }],
  customer: { name: "Juan Pérez", phone: "11 5555-1234" },
  fulfillment: "takeaway",
  paymentMethod: "cash",
  source: "whatsapp",
  clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
  expectedTotalCents: 900_000,
};

describe("15b: order sources", () => {
  it("has web, local and whatsapp, with manual ones being local and whatsapp", () => {
    expect(ORDER_SOURCES).toEqual(["web", "local", "whatsapp"]);
    expect(MANUAL_ORDER_SOURCES).toEqual(["local", "whatsapp"]);
    expect(ORDER_SOURCE_LABELS).toEqual({ web: "Web", local: "Local", whatsapp: "WhatsApp" });
  });
});

describe("15b: createManualOrderRequestSchema", () => {
  it("normalizes the phone of a WhatsApp order", () => {
    const parsed = createManualOrderRequestSchema.parse(validOrder);
    expect(parsed.customer.phone).toBe("5491155551234");
    expect(parsed.markPaid).toBe(false);
    expect(parsed.notes).toBeNull();
  });

  it("requires the phone only for WhatsApp", () => {
    expect(
      createManualOrderRequestSchema.safeParse({ ...validOrder, customer: { name: "Juan" } }).success,
    ).toBe(false);
    const local = createManualOrderRequestSchema.parse({
      ...validOrder,
      source: "local",
      customer: { name: "Juan" },
    });
    expect(local.customer.phone).toBe("");
  });

  it("trims the comment and turns a blank one into null", () => {
    expect(createManualOrderRequestSchema.parse({ ...validOrder, notes: "  timbre 2B  " }).notes).toBe("timbre 2B");
    expect(createManualOrderRequestSchema.parse({ ...validOrder, notes: "   " }).notes).toBeNull();
  });

  it(`rejects a comment over ${ORDER_NOTES_MAX_LENGTH} characters`, () => {
    const result = createManualOrderRequestSchema.safeParse({
      ...validOrder,
      notes: "a".repeat(ORDER_NOTES_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts markPaid and keeps it false by default", () => {
    expect(createManualOrderRequestSchema.parse({ ...validOrder, markPaid: true }).markPaid).toBe(true);
    expect(createManualOrderRequestSchema.parse(validOrder).markPaid).toBe(false);
  });

  it("keeps the public charge rules: a tip is not allowed on takeaway", () => {
    expect(createManualOrderRequestSchema.safeParse({ ...validOrder, tipCents: 10_000 }).success).toBe(false);
  });

  it("requires an address for delivery", () => {
    expect(
      createManualOrderRequestSchema.safeParse({ ...validOrder, fulfillment: "delivery" }).success,
    ).toBe(false);
    const withAddress = createManualOrderRequestSchema.parse({
      ...validOrder,
      fulfillment: "delivery",
      customer: { ...validOrder.customer, address: "Calle 1" },
    });
    expect(withAddress.customer.address).toBe("Calle 1");
  });
});
