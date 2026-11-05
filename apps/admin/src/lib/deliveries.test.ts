import { describe, expect, it } from "vitest";
import type { CourierDelivery } from "@menucito/shared";
import {
  DELIVERIES_UI_MESSAGES,
  directionsUrl,
  isDeliveryGoneError,
  mapsUrlForDelivery,
  sortDeliveriesByProximity,
  todayAndTomorrowRange,
} from "./deliveries";
import { ApiError } from "./restaurant";

function delivery(
  id: string,
  number: number,
  location: { lat: number; lng: number } | null,
  overrides: Partial<CourierDelivery> = {},
): CourierDelivery {
  return {
    id,
    number,
    customerName: "Juan",
    customerPhone: "5491112345678",
    deliveryAddress: "Av. Siempre Viva 742",
    deliveryLocation: location && {
      ...location,
      placeId: null,
      unit: "Piso 3 B",
      betweenStreets: "Evergreen y Maple",
      label: null,
      zoneName: null,
      distanceM: null,
    },
    notes: null,
    paymentMethod: "cash",
    totalCents: 30_500,
    shippingCents: 2_000,
    tipCents: 0,
    sentAt: 1,
    ...overrides,
  };
}

describe("mapsUrlForDelivery (13 scenario 45)", () => {
  it("searches by the pinned coordinates when the order was geocoded", () => {
    const order = delivery("a", 1, { lat: -34.6, lng: -58.38 });
    expect(mapsUrlForDelivery(order)).toBe("https://www.google.com/maps/search/?api=1&query=-34.6,-58.38");
  });

  it("searches by the typed address when there are no coordinates", () => {
    const order = delivery("a", 1, null, { deliveryAddress: "Mitre 1550, Banfield" });
    expect(mapsUrlForDelivery(order)).toBe(
      "https://www.google.com/maps/search/?api=1&query=Mitre%201550%2C%20Banfield",
    );
  });

  it("has no link without coordinates nor address", () => {
    expect(mapsUrlForDelivery(delivery("a", 1, null, { deliveryAddress: null }))).toBeNull();
  });
});

describe("sortDeliveriesByProximity (13 decision 18)", () => {
  const store = { lat: 0, lng: 0 };
  const close = delivery("close", 1, { lat: 0, lng: 0.1 });
  const far = delivery("far", 2, { lat: 0, lng: 1 });
  const mid = delivery("mid", 3, { lat: 0, lng: 0.5 });
  const noLocation = delivery("none", 4, null);

  it("starts at the closest stop and keeps taking the closest to the previous one", () => {
    expect(sortDeliveriesByProximity(store, [far, close, mid, noLocation]).map((o) => o.id)).toEqual([
      "close",
      "mid",
      "far",
      "none",
    ]);
  });

  it("keeps the API order when the store has no coordinates", () => {
    expect(sortDeliveriesByProximity(null, [far, noLocation, close]).map((o) => o.id)).toEqual([
      "far",
      "none",
      "close",
    ]);
  });
});

describe("directionsUrl (13 decision 18)", () => {
  const store = { lat: -34.6, lng: -58.38 };

  it("needs the store location and at least one stop with coordinates", () => {
    expect(directionsUrl(null, [delivery("a", 1, { lat: 1, lng: 2 })])).toBeNull();
    expect(directionsUrl(store, [delivery("a", 1, null)])).toBeNull();
  });

  it("puts the only stop as the destination", () => {
    expect(directionsUrl(store, [delivery("a", 1, { lat: -34.7, lng: -58.4 })])).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=-34.6,-58.38&destination=-34.7,-58.4&travelmode=driving",
    );
  });

  it("uses the other stops as waypoints, in the order received", () => {
    expect(
      directionsUrl(store, [
        delivery("a", 1, { lat: 1, lng: 1 }),
        delivery("b", 2, { lat: 2, lng: 2 }),
        delivery("c", 3, { lat: 3, lng: 3 }),
      ]),
    ).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=-34.6,-58.38&destination=3,3&waypoints=1,1|2,2&travelmode=driving",
    );
  });

  it("keeps the link within Google Maps' limit: origin plus the first ten stops", () => {
    const stops = Array.from({ length: 12 }, (_, index) => delivery(`s${index}`, index + 1, { lat: index + 1, lng: 0 }));
    const url = directionsUrl(store, stops)!;
    expect(url).toContain("destination=10,0");
    expect(url).toContain("waypoints=1,0|2,0|3,0|4,0|5,0|6,0|7,0|8,0|9,0");
    expect(url).not.toContain("11,0");
  });
});

describe("todayAndTomorrowRange", () => {
  it("returns two consecutive local days", () => {
    const range = todayAndTomorrowRange(new Date("2026-11-05T15:00:00Z").getTime());
    expect(range).toEqual({ from: "2026-11-05", to: "2026-11-06" });
  });
});

describe("DELIVERIES_UI_MESSAGES", () => {
  it("keeps the copy in Spanish", () => {
    expect(DELIVERIES_UI_MESSAGES.deliverFailed).toContain("No pudimos marcar el pedido");
    expect(DELIVERIES_UI_MESSAGES.deliverGone).toContain("Lo sacamos de la lista");
    expect(DELIVERIES_UI_MESSAGES.empty).toBe("No tenés pedidos en camino.");
  });
});

describe("isDeliveryGoneError", () => {
  it("recognizes a reassigned order and one that is no longer sent", () => {
    expect(isDeliveryGoneError(new ApiError(404, "ORDER_NOT_FOUND", "x"))).toBe(true);
    expect(isDeliveryGoneError(new ApiError(409, "INVALID_TRANSITION", "x"))).toBe(true);
  });

  it("leaves network and other failures for the generic retry message", () => {
    expect(isDeliveryGoneError(new ApiError(500, "INTERNAL_ERROR", "x"))).toBe(false);
    expect(isDeliveryGoneError(new Error("offline"))).toBe(false);
  });
});