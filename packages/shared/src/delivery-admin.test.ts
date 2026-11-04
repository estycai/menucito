import { describe, expect, it } from "vitest";
import {
  LOCATION_MESSAGES,
  MAX_DELIVERY_ZONES,
  hasCoordinates,
  placeIdSchema,
  placeSearchQuerySchema,
  replaceDeliveryZonesSchema,
  storeLocationSchema,
} from "./delivery";

const LOCATION = { address: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816, placeId: "ChIJabc" };

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("storeLocationSchema", () => {
  it("accepts a flat store without a location and normalizes the missing fields to null", () => {
    const parsed = storeLocationSchema.parse({ deliveryMode: "flat" });
    expect(parsed).toEqual({ deliveryMode: "flat", address: null, addressNotes: null, lat: null, lng: null, placeId: null });
    expect(hasCoordinates(parsed)).toBe(false);
  });

  it("accepts zones with a full location and trims the texts", () => {
    const parsed = storeLocationSchema.parse({ deliveryMode: "zones", ...LOCATION, addressNotes: "  Timbre 2B  " });
    expect(parsed.addressNotes).toBe("Timbre 2B");
    expect(hasCoordinates(parsed)).toBe(true);
  });

  it("treats empty notes as none", () => {
    expect(storeLocationSchema.parse({ deliveryMode: "flat", ...LOCATION, addressNotes: "   " }).addressNotes).toBeNull();
  });

  it("rejects an address without coordinates", () => {
    const result = storeLocationSchema.safeParse({ deliveryMode: "flat", address: "Corrientes 1234" });
    expect(firstMessage(result)).toBe(LOCATION_MESSAGES.locationIncomplete);
  });

  it("rejects zones without a location", () => {
    const result = storeLocationSchema.safeParse({ deliveryMode: "zones" });
    expect(firstMessage(result)).toBe(LOCATION_MESSAGES.zonesNeedLocation);
  });

  it("rejects an unknown mode", () => {
    expect(storeLocationSchema.safeParse({ deliveryMode: "drone" }).success).toBe(false);
  });
});

describe("replaceDeliveryZonesSchema", () => {
  const zone = {
    name: "Centro",
    color: "#c2410c",
    active: true,
    shape: "radius",
    radiusM: 2000,
    pricing: "fixed",
    priceCents: 50000,
  };

  it("accepts a zone with an optional id and normalizes its color", () => {
    const parsed = replaceDeliveryZonesSchema.parse({ zones: [{ ...zone, id: "z1" }, zone] });
    expect(parsed.zones[0]).toMatchObject({ id: "z1", color: "#C2410C", active: true });
    expect(parsed.zones[1]?.id).toBeUndefined();
  });

  it("requires `active`", () => {
    expect(replaceDeliveryZonesSchema.safeParse({ zones: [{ ...zone, active: undefined }] }).success).toBe(false);
  });

  it(`rejects more than ${MAX_DELIVERY_ZONES} zones`, () => {
    const result = replaceDeliveryZonesSchema.safeParse({ zones: Array.from({ length: MAX_DELIVERY_ZONES + 1 }, () => zone) });
    expect(firstMessage(result)).toBe(LOCATION_MESSAGES.tooManyZones);
  });
});

describe("place search inputs", () => {
  it("trims the query and requires a session token", () => {
    expect(placeSearchQuerySchema.parse({ q: " corrientes ", session: "0f8b2c1e-1234" }).q).toBe("corrientes");
    expect(placeSearchQuerySchema.safeParse({ q: "corrientes" }).success).toBe(false);
    expect(placeSearchQuerySchema.safeParse({ q: "  ", session: "0f8b2c1e-1234" }).success).toBe(false);
  });

  it("only accepts URL-safe place ids", () => {
    expect(placeIdSchema.safeParse("ChIJ-abc_123").success).toBe(true);
    expect(placeIdSchema.safeParse("../geocode").success).toBe(false);
  });
});
