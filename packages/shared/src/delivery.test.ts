import { describe, expect, it } from "vitest";
import { DELIVERY_MESSAGES, deliveryZoneInputSchema, latLngSchema, type DeliveryZone, type LatLng } from "./delivery";
import { distanceMeters, findZone, pointInPolygon, quoteDelivery, zoneContains, zoneShippingCents } from "./delivery-coverage";
import { MAX_MONEY_CENTS } from "./settings";

/** Obelisco, Buenos Aires: the store in every test. */
const ORIGIN: LatLng = { lat: -34.6037, lng: -58.3816 };
/** Degrees of latitude per meter along a meridian (mean Earth radius). */
const LAT_PER_M = 360 / (2 * Math.PI * 6_371_008.8);

/** A point `meters` due north of the store. */
const north = (meters: number): LatLng => ({ lat: ORIGIN.lat + meters * LAT_PER_M, lng: ORIGIN.lng });

/** Every field of every zone variant, flattened, so a test can set any of them. */
type AnyZoneField = DeliveryZone extends infer Z ? (Z extends unknown ? keyof Z : never) : never;
type ZoneOverrides = { [K in AnyZoneField]?: unknown } & Partial<Pick<DeliveryZone, "shape" | "pricing">>;

let nextId = 0;
/** A zone with every shape and pricing field filled; `shape` and `pricing` pick which ones count. */
function zone(overrides: ZoneOverrides): DeliveryZone {
  nextId += 1;
  return {
    id: `z${nextId}`,
    name: `Zona ${nextId}`,
    color: "#C2410C",
    active: true,
    sort: nextId,
    radiusM: 1000,
    innerRadiusM: 0,
    polygon: [],
    priceCents: 50000,
    baseCents: 0,
    perKmCents: 0,
    ...overrides,
  } as unknown as DeliveryZone;
}

const perKm = (overrides: ZoneOverrides = {}) =>
  zone({ shape: "radius", radiusM: 50_000, pricing: "per_km", baseCents: 50000, perKmCents: 10000, ...overrides });

describe("distanceMeters", () => {
  it("measures about 1 km between two points 1 km apart on a meridian", () => {
    const d = distanceMeters(ORIGIN, north(1000));
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it("measures east-west distances shrunk by the latitude (Buenos Aires, 0.01° of longitude ≈ 916 m)", () => {
    const d = distanceMeters(ORIGIN, { lat: ORIGIN.lat, lng: ORIGIN.lng + 0.01 });
    const expected = 0.01 * (Math.PI / 180) * 6_371_008.8 * Math.cos((ORIGIN.lat * Math.PI) / 180);
    expect(Math.abs(d - expected) / expected).toBeLessThan(0.01);
  });

  it("is zero for the same point and symmetric", () => {
    const other = { lat: -34.62, lng: -58.4 };
    expect(distanceMeters(ORIGIN, ORIGIN)).toBe(0);
    expect(distanceMeters(ORIGIN, other)).toBeCloseTo(distanceMeters(other, ORIGIN), 6);
  });
});

describe("pointInPolygon", () => {
  // A "C" open to the east (vertices are [lat, lng]): the notch between lat 1 and 2 from lng 1 on is outside.
  const cShape: [number, number][] = [
    [0, 0],
    [0, 3],
    [1, 3],
    [1, 1],
    [2, 1],
    [2, 3],
    [3, 3],
    [3, 0],
  ];

  it("finds points inside a convex polygon and rejects points outside", () => {
    const square: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 0.5, lng: -0.1 }, square)).toBe(false);
  });

  it("handles a concave polygon: the arms are inside, the notch between them is outside", () => {
    expect(pointInPolygon({ lat: 0.5, lng: 2 }, cShape)).toBe(true);
    expect(pointInPolygon({ lat: 2.5, lng: 2 }, cShape)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, cShape)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 2 }, cShape)).toBe(false);
    expect(pointInPolygon({ lat: 5, lng: 5 }, cShape)).toBe(false);
  });
});

describe("zoneContains", () => {
  it("includes the edge of a radius zone and excludes anything beyond it", () => {
    const point = north(1500);
    const d = distanceMeters(ORIGIN, point);
    expect(zoneContains(zone({ shape: "radius", radiusM: d, pricing: "fixed" }), ORIGIN, point)).toBe(true);
    expect(zoneContains(zone({ shape: "radius", radiusM: d - 0.01, pricing: "fixed" }), ORIGIN, point)).toBe(false);
  });

  it("excludes the inner edge of a ring and includes its outer edge", () => {
    const point = north(2000);
    const d = distanceMeters(ORIGIN, point);
    expect(zoneContains(zone({ shape: "ring", innerRadiusM: d, radiusM: d + 1000, pricing: "fixed" }), ORIGIN, point)).toBe(false);
    expect(zoneContains(zone({ shape: "ring", innerRadiusM: d - 1000, radiusM: d, pricing: "fixed" }), ORIGIN, point)).toBe(true);
    expect(zoneContains(zone({ shape: "ring", innerRadiusM: 1000, radiusM: 3000, pricing: "fixed" }), ORIGIN, north(500))).toBe(false);
  });

  it("checks polygons by shape alone, not by distance to the store", () => {
    const polygon: [number, number][] = [
      [-34.7, -58.5],
      [-34.7, -58.4],
      [-34.6, -58.4],
      [-34.6, -58.5],
    ];
    const z = zone({ shape: "polygon", polygon, pricing: "fixed" });
    expect(zoneContains(z, ORIGIN, { lat: -34.65, lng: -58.45 })).toBe(true);
    expect(zoneContains(z, ORIGIN, ORIGIN)).toBe(false);
  });
});

describe("findZone", () => {
  it("returns the zone with the lowest sort when zones overlap, whatever the array order", () => {
    const wide = zone({ shape: "radius", radiusM: 5000, pricing: "fixed", sort: 2 });
    const narrow = zone({ shape: "radius", radiusM: 3000, pricing: "fixed", sort: 1 });
    expect(findZone([wide, narrow], ORIGIN, north(1000))?.id).toBe(narrow.id);
    expect(findZone([wide, narrow], ORIGIN, north(4000))?.id).toBe(wide.id);
  });

  it("skips inactive zones", () => {
    const paused = zone({ shape: "radius", radiusM: 5000, pricing: "fixed", sort: 1, active: false });
    const fallback = zone({ shape: "radius", radiusM: 5000, pricing: "fixed", sort: 2 });
    expect(findZone([paused, fallback], ORIGIN, north(1000))?.id).toBe(fallback.id);
    expect(findZone([paused], ORIGIN, north(1000))).toBeNull();
  });

  it("returns null when no zone covers the point", () => {
    expect(findZone([zone({ shape: "radius", radiusM: 1000, pricing: "fixed" })], ORIGIN, north(2000))).toBeNull();
    expect(findZone([], ORIGIN, ORIGIN)).toBeNull();
  });
});

describe("zoneShippingCents", () => {
  it("charges the fixed price whatever the distance", () => {
    const z = zone({ shape: "radius", pricing: "fixed", priceCents: 123456 });
    expect(zoneShippingCents(z, 100, 0)).toBe(123456);
    expect(zoneShippingCents(z, 9000, 0)).toBe(123456);
  });

  it("charges base plus fractional km for per-km pricing", () => {
    // $500 + $100/km × 1.5 km = $650
    expect(zoneShippingCents(perKm(), 1500, 0)).toBe(65000);
  });

  it("rounds per-km prices to whole pesos, half up", () => {
    // $500 + $100.40 → $600.40 → $600
    expect(zoneShippingCents(perKm(), 1004, 0)).toBe(60000);
    // $500 + $100.50 → $600.50 → $601
    expect(zoneShippingCents(perKm(), 1005, 0)).toBe(60100);
    // $500 + $100.60 → $600.60 → $601
    expect(zoneShippingCents(perKm(), 1006, 0)).toBe(60100);
  });

  it("clamps per-km prices to the minimum and maximum shipping, keeping bounds exact", () => {
    const bounded = perKm({ minShippingCents: 70050, maxShippingCents: 90000 });
    expect(zoneShippingCents(bounded, 100, 0)).toBe(70050);
    expect(zoneShippingCents(bounded, 10_000, 0)).toBe(90000);
    expect(zoneShippingCents(bounded, 3000, 0)).toBe(80000);
    expect(zoneShippingCents(perKm({ maxShippingCents: null }), 10_000, 0)).toBe(150000);
  });

  it("is free once the subtotal reaches freeFromCents, for both pricings", () => {
    const fixed = zone({ shape: "radius", pricing: "fixed", priceCents: 50000, freeFromCents: 1_000_000 });
    expect(zoneShippingCents(fixed, 500, 999_999)).toBe(50000);
    expect(zoneShippingCents(fixed, 500, 1_000_000)).toBe(0);
    const km = perKm({ freeFromCents: 1_000_000, minShippingCents: 70000 });
    expect(zoneShippingCents(km, 500, 1_500_000)).toBe(0);
  });
});

describe("quoteDelivery", () => {
  it("reports an address outside every zone as not covered", () => {
    const zones = [zone({ shape: "radius", radiusM: 1000, pricing: "fixed" })];
    expect(quoteDelivery({ zones, origin: ORIGIN, point: north(5000), subtotalCents: 100000 })).toEqual({ covered: false });
  });

  it("quotes the winning zone with whole-meter distance, shipping and its minimum order", () => {
    const near = zone({ shape: "radius", radiusM: 1000, pricing: "fixed", priceCents: 30000, sort: 1, minOrderCents: 500000 });
    const far = perKm({ sort: 2 });
    const point = north(2500.4);

    expect(quoteDelivery({ zones: [far, near], origin: ORIGIN, point: north(800), subtotalCents: 100000 })).toEqual({
      covered: true,
      zoneId: near.id,
      zoneName: near.name,
      distanceM: 800,
      shippingCents: 30000,
      minOrderCents: 500000,
    });
    expect(quoteDelivery({ zones: [far, near], origin: ORIGIN, point, subtotalCents: 100000 })).toEqual({
      covered: true,
      zoneId: far.id,
      zoneName: far.name,
      distanceM: 2500,
      shippingCents: 75000,
      minOrderCents: null,
    });
  });
});

describe("latLngSchema", () => {
  it("accepts coordinates in range and rejects out of range or non-finite ones", () => {
    expect(latLngSchema.safeParse({ lat: -34.6, lng: -58.38 }).success).toBe(true);
    expect(latLngSchema.safeParse({ lat: 90, lng: -180 }).success).toBe(true);
    expect(latLngSchema.safeParse({ lat: 90.1, lng: 0 }).success).toBe(false);
    expect(latLngSchema.safeParse({ lat: 0, lng: 180.1 }).success).toBe(false);
    expect(latLngSchema.safeParse({ lat: Number.NaN, lng: 0 }).success).toBe(false);
    expect(latLngSchema.safeParse({ lat: 0, lng: Number.POSITIVE_INFINITY }).success).toBe(false);
  });
});

describe("deliveryZoneInputSchema", () => {
  const base = { name: "  Centro  ", color: "#c2410c" };
  const firstMessage = (input: unknown) => {
    const result = deliveryZoneInputSchema.safeParse(input);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a radius zone with fixed price, trimming the name, normalizing the color and dropping other variants' fields", () => {
    const result = deliveryZoneInputSchema.parse({
      ...base,
      shape: "radius",
      radiusM: 3000,
      innerRadiusM: 1000,
      pricing: "fixed",
      priceCents: 50000,
      perKmCents: 999,
    });
    expect(result).toEqual({ name: "Centro", color: "#C2410C", shape: "radius", radiusM: 3000, pricing: "fixed", priceCents: 50000 });
  });

  it("accepts a ring with per-km pricing and min ≤ max, and a polygon of 3 points", () => {
    expect(
      deliveryZoneInputSchema.safeParse({
        ...base,
        shape: "ring",
        innerRadiusM: 1000,
        radiusM: 3000,
        pricing: "per_km",
        baseCents: 50000,
        perKmCents: 10000,
        minShippingCents: 60000,
        maxShippingCents: 60000,
        minOrderCents: 300000,
        freeFromCents: null,
      }).success,
    ).toBe(true);
    expect(
      deliveryZoneInputSchema.safeParse({
        ...base,
        shape: "polygon",
        polygon: [
          [-34.6, -58.4],
          [-34.61, -58.4],
          [-34.61, -58.39],
        ],
        pricing: "fixed",
        priceCents: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects a ring whose inner radius is not below the outer one", () => {
    const ring = { ...base, shape: "ring", pricing: "fixed", priceCents: 50000 };
    expect(firstMessage({ ...ring, innerRadiusM: 3000, radiusM: 3000 })).toBe(DELIVERY_MESSAGES.ringInvalid);
    expect(firstMessage({ ...ring, innerRadiusM: 4000, radiusM: 3000 })).toBe(DELIVERY_MESSAGES.ringInvalid);
  });

  it("rejects polygons with fewer than 3 points or more than 100", () => {
    const polygon = { ...base, shape: "polygon", pricing: "fixed", priceCents: 50000 };
    expect(
      firstMessage({
        ...polygon,
        polygon: [
          [0, 0],
          [0, 1],
        ],
      }),
    ).toBe(DELIVERY_MESSAGES.polygonTooFew);
    const tooMany = Array.from({ length: 101 }, (_, i) => [0, i / 1000]);
    expect(firstMessage({ ...polygon, polygon: tooMany })).toBe(DELIVERY_MESSAGES.polygonTooMany);
    expect(firstMessage({ ...polygon, polygon: [[0, 0], [0, 1], [91, 0]] })).toBe(DELIVERY_MESSAGES.latInvalid);
  });

  it("rejects per-km pricing with min shipping above max, or missing amounts", () => {
    const km = { ...base, shape: "radius", radiusM: 3000, pricing: "per_km", baseCents: 50000, perKmCents: 10000 };
    expect(firstMessage({ ...km, minShippingCents: 90000, maxShippingCents: 80000 })).toBe(DELIVERY_MESSAGES.minAboveMax);
    expect(deliveryZoneInputSchema.safeParse({ ...km, perKmCents: undefined }).success).toBe(false);
    expect(deliveryZoneInputSchema.safeParse({ ...base, shape: "radius", radiusM: 3000, pricing: "fixed" }).success).toBe(false);
  });

  it("rejects invalid radii, money and names", () => {
    const radius = { ...base, shape: "radius", pricing: "fixed", priceCents: 50000 };
    expect(firstMessage({ ...radius, radiusM: 0 })).toBe(DELIVERY_MESSAGES.radiusInvalid);
    expect(firstMessage({ ...radius, radiusM: 50_001 })).toBe(DELIVERY_MESSAGES.radiusInvalid);
    expect(firstMessage({ ...radius, radiusM: 1500.5 })).toBe(DELIVERY_MESSAGES.radiusInvalid);
    expect(firstMessage({ ...radius, radiusM: 3000, priceCents: MAX_MONEY_CENTS + 1 })).toBe(DELIVERY_MESSAGES.moneyInvalid);
    expect(firstMessage({ ...radius, radiusM: 3000, priceCents: -1 })).toBe(DELIVERY_MESSAGES.moneyInvalid);
    expect(firstMessage({ ...radius, radiusM: 3000, name: "   " })).toBe(DELIVERY_MESSAGES.zoneNameRequired);
    expect(firstMessage({ ...radius, radiusM: 3000, name: "x".repeat(41) })).toBe(DELIVERY_MESSAGES.zoneNameTooLong);
  });

  it("rejects unknown shapes and pricings", () => {
    expect(firstMessage({ ...base, shape: "square", pricing: "fixed", priceCents: 1 })).toBe(DELIVERY_MESSAGES.shapeInvalid);
    expect(firstMessage({ ...base, shape: "radius", radiusM: 1000, pricing: "free" })).toBe(DELIVERY_MESSAGES.pricingInvalid);
  });
});
