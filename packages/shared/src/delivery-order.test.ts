import { describe, expect, it } from "vitest";
import {
  DELIVERY_UNIT_MAX_LENGTH,
  deliveryQuoteRequestSchema,
  orderDeliverySchema,
  reverseGeocodeQuerySchema,
} from "./delivery";
import { toPublicQuote, orderStopsByProximity } from "./delivery-coverage";
import { createOrderRequestSchema } from "./orders";

const delivery = {
  placeId: "ChIJ-corrientes",
  lat: -34.6037,
  lng: -58.3816,
  formattedAddress: " Av. Corrientes 1234, CABA ",
  locality: "Buenos Aires",
  unit: " 3B ",
  betweenStreets: "",
  label: "home",
};

describe("orderDeliverySchema", () => {
  it("trims the texts and turns empty or missing optionals into null", () => {
    const parsed = orderDeliverySchema.parse(delivery);
    expect(parsed).toEqual({
      placeId: "ChIJ-corrientes",
      lat: -34.6037,
      lng: -58.3816,
      formattedAddress: "Av. Corrientes 1234, CABA",
      locality: "Buenos Aires",
      unit: "3B",
      betweenStreets: null,
      label: "home",
    });
    expect(orderDeliverySchema.parse({ lat: 0, lng: 0, formattedAddress: "x" })).toMatchObject({
      placeId: null,
      locality: null,
      unit: null,
      label: null,
    });
  });

  it("rejects bad coordinates, an empty address, a long unit and an unknown label", () => {
    expect(orderDeliverySchema.safeParse({ ...delivery, lat: 91 }).success).toBe(false);
    expect(orderDeliverySchema.safeParse({ ...delivery, formattedAddress: "  " }).success).toBe(false);
    expect(orderDeliverySchema.safeParse({ ...delivery, unit: "x".repeat(DELIVERY_UNIT_MAX_LENGTH + 1) }).success).toBe(false);
    expect(orderDeliverySchema.safeParse({ ...delivery, label: "gym" }).success).toBe(false);
    expect(orderDeliverySchema.safeParse({ ...delivery, placeId: "bad id" }).success).toBe(false);
  });
});

describe("createOrderRequestSchema with a geocoded address", () => {
  const base = {
    items: [{ productId: "prod-1", quantity: 1 }],
    customer: { name: "Juan", phone: "11 5555-1234", address: null },
    fulfillment: "delivery",
    paymentMethod: "cash",
    clientOrderId: "123e4567-e89b-12d3-a456-426614174000",
    expectedTotalCents: 100,
  };

  it("accepts a delivery order with `delivery` and no typed address", () => {
    const parsed = createOrderRequestSchema.parse({ ...base, delivery });
    expect(parsed.customer.address).toBeNull();
    expect(parsed.delivery?.formattedAddress).toBe("Av. Corrientes 1234, CABA");
  });

  it("still requires some address for delivery", () => {
    const res = createOrderRequestSchema.safeParse(base);
    expect(res.success).toBe(false);
  });

  it("drops `delivery` on takeaway orders", () => {
    const parsed = createOrderRequestSchema.parse({ ...base, fulfillment: "takeaway", delivery });
    expect(parsed.delivery).toBeNull();
  });

  it("validates `delivery`", () => {
    expect(createOrderRequestSchema.safeParse({ ...base, delivery: { ...delivery, lng: 200 } }).success).toBe(false);
  });
});

describe("public quote inputs", () => {
  it("coerces the reverse geocode query and checks ranges", () => {
    expect(reverseGeocodeQuerySchema.parse({ lat: "-34.6", lng: "-58.4" })).toEqual({ lat: -34.6, lng: -58.4 });
    expect(reverseGeocodeQuerySchema.safeParse({ lat: "abc", lng: "-58.4" }).success).toBe(false);
    expect(reverseGeocodeQuerySchema.safeParse({ lat: "-34.6" }).success).toBe(false);
    expect(reverseGeocodeQuerySchema.safeParse({ lat: "-100", lng: "0" }).success).toBe(false);
  });

  it("requires a whole, non-negative subtotal", () => {
    expect(deliveryQuoteRequestSchema.safeParse({ lat: 0, lng: 0, subtotalCents: 1.5 }).success).toBe(false);
    expect(deliveryQuoteRequestSchema.safeParse({ lat: 0, lng: 0, subtotalCents: -1 }).success).toBe(false);
    expect(deliveryQuoteRequestSchema.parse({ lat: 0, lng: 0, subtotalCents: 0 })).toEqual({ lat: 0, lng: 0, subtotalCents: 0 });
  });

  it("hides the zone from the public quote", () => {
    expect(toPublicQuote({ covered: false })).toEqual({ covered: false });
    expect(
      toPublicQuote({ covered: true, zoneId: "z1", zoneName: "Centro", distanceM: 900, shippingCents: 500, minOrderCents: null }),
    ).toEqual({ covered: true, shippingCents: 500, minOrderCents: null });
  });
});

describe("13 scenario 29b: orderStopsByProximity", () => {
  const stop = (id: string, lat: number | null, lng: number | null) => ({ id, lat, lng });

  it("starts at the nearest to the store and follows the nearest to the previous stop", () => {
    const stops = [stop("A", 0, 0.02), stop("B", 0, 0.01), stop("C", 0, 0.03)];
    expect(orderStopsByProximity({ lat: 0, lng: 0 }, stops).map((s) => s.id)).toEqual(["B", "A", "C"]);
  });

  it("leaves the stops without coordinates at the end, in their input order", () => {
    const stops = [stop("A", 0, 0.02), stop("no-1", null, null), stop("B", 0, 0.01), stop("no-2", 0, null)];
    expect(orderStopsByProximity({ lat: 0, lng: 0 }, stops).map((s) => s.id)).toEqual(["B", "A", "no-1", "no-2"]);
  });

  it("keeps the input order when the store has no coordinates", () => {
    const stops = [stop("A", 0, 0.02), stop("B", 0, 0.01), stop("no", null, null)];
    expect(orderStopsByProximity(null, stops).map((s) => s.id)).toEqual(["A", "B", "no"]);
  });
});
