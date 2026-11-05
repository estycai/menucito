/**
 * Delivery coverage and pricing: which zone covers an address and what shipping it pays. Pure
 * functions with no geocoding and no DB: the API quotes with them when an order arrives and the
 * menu can run the same code to show the price before sending.
 */
import type { DeliveryZone, LatLng, LatLngTuple, PublicDeliveryQuote } from "./delivery";

/** Mean Earth radius in meters (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in meters between two points (haversine formula). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether `point` lies inside `polygon` (vertices `[lat, lng]`, closing edge implied), by ray
 * casting with lng as x and lat as y. Planar on purpose: delivery areas span a few km, where the
 * error is negligible. A point exactly on an edge may fall on either side.
 */
export function pointInPolygon(point: LatLng, polygon: readonly LatLngTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i] as LatLngTuple;
    const [latJ, lngJ] = polygon[j] as LatLngTuple;
    // The edge crosses the horizontal line through the point, to the right of the point.
    if (latI > point.lat !== latJ > point.lat && point.lng < ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether `zone` covers `point`. Radius and ring zones measure from `origin` (the store): a radius
 * includes its edge, a ring excludes its inner edge and includes its outer one, so contiguous rings
 * never overlap. Polygons ignore `origin`.
 */
export function zoneContains(zone: DeliveryZone, origin: LatLng, point: LatLng): boolean {
  switch (zone.shape) {
    case "radius":
      return distanceMeters(origin, point) <= zone.radiusM;
    case "ring": {
      const d = distanceMeters(origin, point);
      return d > zone.innerRadiusM && d <= zone.radiusM;
    }
    case "polygon":
      return pointInPolygon(point, zone.polygon);
  }
}

/** The first active zone by ascending `sort` that covers `point`, or `null` when none does. */
export function findZone(zones: readonly DeliveryZone[], origin: LatLng, point: LatLng): DeliveryZone | null {
  const candidates = zones.filter((zone) => zone.active).sort((a, b) => a.sort - b.sort);
  return candidates.find((zone) => zoneContains(zone, origin, point)) ?? null;
}

const CENTS_PER_PESO = 100;

/**
 * Shipping of an order to `zone`, `distanceM` meters away from the store:
 * - free (0) when the zone has `freeFromCents` and the subtotal reaches it;
 * - `fixed`: `priceCents` as is;
 * - `per_km`: `baseCents + perKmCents × km` with fractional km (1.5 km pays 1.5 × perKm), rounded
 *   to whole pesos half-up (x,50 goes up), then clamped to `minShippingCents`/`maxShippingCents`
 *   when set. Clamping after rounding keeps the owner's bounds exact even when they have cents.
 */
export function zoneShippingCents(zone: DeliveryZone, distanceM: number, subtotalCents: number): number {
  if (zone.freeFromCents != null && subtotalCents >= zone.freeFromCents) return 0;
  if (zone.pricing === "fixed") return zone.priceCents;

  const raw = zone.baseCents + (zone.perKmCents * distanceM) / 1000;
  // Round to cents first so float noise (1049.9999…) cannot flip the half-peso rounding.
  const cents = Math.round(raw);
  // Values are never negative here, where `Math.round` is round-half-up.
  let shipping = Math.round(cents / CENTS_PER_PESO) * CENTS_PER_PESO;
  if (zone.minShippingCents != null) shipping = Math.max(shipping, zone.minShippingCents);
  if (zone.maxShippingCents != null) shipping = Math.min(shipping, zone.maxShippingCents);
  return shipping;
}

export interface QuoteDeliveryInput {
  zones: readonly DeliveryZone[];
  /** Where the store is. */
  origin: LatLng;
  /** The geocoded delivery address. */
  point: LatLng;
  subtotalCents: number;
}

export type DeliveryQuote =
  | { covered: false }
  | {
      covered: true;
      zoneId: string;
      zoneName: string;
      /** Straight-line distance from the store, in whole meters. */
      distanceM: number;
      shippingCents: number;
      /** Minimum subtotal the zone asks for, or `null` when it has none. */
      minOrderCents: number | null;
    };

/** Which zone covers the address and what it costs; `{ covered: false }` when no zone does. */
export function quoteDelivery({ zones, origin, point, subtotalCents }: QuoteDeliveryInput): DeliveryQuote {
  const zone = findZone(zones, origin, point);
  if (!zone) return { covered: false };
  const distanceM = distanceMeters(origin, point);
  return {
    covered: true,
    zoneId: zone.id,
    zoneName: zone.name,
    distanceM: Math.round(distanceM),
    shippingCents: zoneShippingCents(zone, distanceM, subtotalCents),
    minOrderCents: zone.minOrderCents ?? null,
  };
}

/** The part of a quote the diner may see: no zone id, name or distance. */
export function toPublicQuote(quote: DeliveryQuote): PublicDeliveryQuote {
  if (!quote.covered) return { covered: false };
  return { covered: true, shippingCents: quote.shippingCents, minOrderCents: quote.minOrderCents };
}

/** A stop of a courier route: coordinates when the address was geocoded. */
export interface OrderStop {
  lat: number | null;
  lng: number | null;
}

/**
 * Orders `stops` for a courier route: starts with the stop closest to the store, then keeps taking
 * the closest to the previous one, and leaves the stops without coordinates at the end in their
 * input order. Without a store location there is nothing to optimize, so the input order is kept.
 */
export function orderStopsByProximity<T extends OrderStop>(store: LatLng | null, stops: readonly T[]): T[] {
  if (!store) return [...stops];
  const located = stops.filter((stop) => stop.lat !== null && stop.lng !== null);
  const withoutLocation = stops.filter((stop) => stop.lat === null || stop.lng === null);
  const ordered: T[] = [];
  const remaining = [...located];
  let origin: LatLng = store;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, stop] of remaining.entries()) {
      const distance = distanceMeters(origin, { lat: stop.lat!, lng: stop.lng! });
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next!);
    origin = { lat: next!.lat!, lng: next!.lng! };
  }
  return [...ordered, ...withoutLocation];
}
