import { describe, expect, it, vi } from "vitest";
import {
  ADDRESS_SEARCH_MESSAGES,
  addressLines,
  addressSearchErrorMessage,
  deliveryPricing,
  fetchDeliveryQuote,
  getPlace,
  highlightSegments,
  reversePlace,
  sameSpot,
  searchPlaces,
  toOrderDelivery,
} from "./delivery-address";

const API = "http://api.local";

const respond = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("highlightSegments", () => {
  it("marks every word of the query, ignoring case and accents", () => {
    expect(highlightSegments("Av. Peña 1234", "pena 12")).toEqual([
      { text: "Av. ", match: false },
      { text: "Peña", match: true },
      { text: " ", match: false },
      { text: "12", match: true },
      { text: "34", match: false },
    ]);
  });

  it("merges adjacent and overlapping matches and marks repeated ones", () => {
    expect(highlightSegments("Calle Calle", "calle")).toEqual([
      { text: "Calle", match: true },
      { text: " ", match: false },
      { text: "Calle", match: true },
    ]);
    expect(highlightSegments("Corrientes", "corr rientes")).toEqual([{ text: "Corrientes", match: true }]);
  });

  it("returns the whole text unmarked for an empty query and nothing for an empty text", () => {
    expect(highlightSegments("Corrientes 1234", "  ")).toEqual([{ text: "Corrientes 1234", match: false }]);
    expect(highlightSegments("", "x")).toEqual([]);
  });
});

describe("addressLines", () => {
  it("splits the street from the locality", () => {
    expect(addressLines({ formattedAddress: "Av. Corrientes 1500, C1043 CABA, Argentina", locality: "Buenos Aires" })).toEqual({
      main: "Av. Corrientes 1500",
      secondary: "Buenos Aires",
    });
  });

  it("falls back to the rest of the address without a locality", () => {
    expect(addressLines({ formattedAddress: "Ruta 2 km 40, Brandsen, Argentina", locality: null })).toEqual({
      main: "Ruta 2 km 40",
      secondary: "Brandsen, Argentina",
    });
    expect(addressLines({ formattedAddress: "Calle 1", locality: null })).toEqual({ main: "Calle 1", secondary: "" });
  });
});

describe("toOrderDelivery", () => {
  const place = { placeId: "ChIJ-1", formattedAddress: "Calle 1, CABA", locality: "CABA", lat: -34.6, lng: -58.4 };

  it("trims the details and turns empty ones into null", () => {
    expect(toOrderDelivery(place, { label: "work", betweenStreets: "  ", unit: " 3B " })).toEqual({
      placeId: "ChIJ-1",
      lat: -34.6,
      lng: -58.4,
      formattedAddress: "Calle 1, CABA",
      locality: "CABA",
      unit: "3B",
      betweenStreets: null,
      label: "work",
    });
  });
});

describe("deliveryPricing", () => {
  const store = { shippingCents: 150_000, minOrderCents: 1_000_000 };

  it("keeps the store's price in flat mode", () => {
    expect(deliveryPricing(false, { status: "idle" }, store)).toEqual({ ...store, covered: null });
  });

  it("charges nothing until the quote arrives", () => {
    expect(deliveryPricing(true, { status: "loading" }, store)).toEqual({ shippingCents: 0, minOrderCents: 1_000_000, covered: null });
    expect(deliveryPricing(true, { status: "error" }, store).covered).toBeNull();
  });

  it("uses the zone's price and minimum, falling back to the store's minimum", () => {
    const zoneMin = { status: "ready", quote: { covered: true, shippingCents: 50_000, minOrderCents: 500_000 } } as const;
    expect(deliveryPricing(true, zoneMin, store)).toEqual({ shippingCents: 50_000, minOrderCents: 500_000, covered: true });
    const noMin = { status: "ready", quote: { covered: true, shippingCents: 0, minOrderCents: null } } as const;
    expect(deliveryPricing(true, noMin, store).minOrderCents).toBe(1_000_000);
  });

  it("flags an address out of coverage", () => {
    expect(deliveryPricing(true, { status: "ready", quote: { covered: false } }, store).covered).toBe(false);
  });
});

describe("sameSpot", () => {
  it("treats points under a meter apart as the same", () => {
    expect(sameSpot({ lat: -34.6, lng: -58.4 }, { lat: -34.600001, lng: -58.400001 })).toBe(true);
    expect(sameSpot({ lat: -34.6, lng: -58.4 }, { lat: -34.6001, lng: -58.4 })).toBe(false);
    expect(sameSpot(null, { lat: 0, lng: 0 })).toBe(false);
  });
});

describe("address search requests", () => {
  it("searches with the query and the session", async () => {
    const fetchImpl = respond(200, [{ placeId: "p1", mainText: "Calle 1", secondaryText: "" }]);
    const result = await searchPlaces(API, "marta", "calle 1", "session-123", fetchImpl);
    expect(result).toEqual({ ok: true, data: [{ placeId: "p1", mainText: "Calle 1", secondaryText: "" }] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${API}/api/public/menus/marta/places/search?q=calle+1&session=session-123`);
  });

  it("resolves a place and reverse geocodes a point", async () => {
    const fetchImpl = respond(200, {});
    await getPlace(API, "marta", "ChIJ-1", "session-123", fetchImpl);
    await reversePlace(API, "marta", { lat: -34.6, lng: -58.4 }, fetchImpl);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${API}/api/public/menus/marta/places/ChIJ-1?session=session-123`);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(`${API}/api/public/menus/marta/places/reverse?lat=-34.6&lng=-58.4`);
  });

  it("posts the quote request", async () => {
    const fetchImpl = respond(200, { covered: false });
    const result = await fetchDeliveryQuote(API, "marta", { lat: 1, lng: 2, subtotalCents: 300 }, { fetchImpl });
    expect(result).toEqual({ ok: true, data: { covered: false } });
    const init = fetchImpl.mock.calls[0]?.[1] ?? {};
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ lat: 1, lng: 2, subtotalCents: 300 });
  });

  it("returns the error code, or NETWORK_ERROR when the request fails", async () => {
    expect(await searchPlaces(API, "marta", "x", "s", respond(429, { error: { code: "RATE_LIMITED", message: "" } }))).toEqual({
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
    });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await searchPlaces(API, "marta", "x", "s", offline)).toEqual({ ok: false, status: 0, code: "NETWORK_ERROR" });
  });

  it("maps error codes to messages for the diner", () => {
    expect(addressSearchErrorMessage("RATE_LIMITED")).toBe(ADDRESS_SEARCH_MESSAGES.rateLimited);
    expect(addressSearchErrorMessage("MAPS_UNAVAILABLE")).toBe(ADDRESS_SEARCH_MESSAGES.unavailable);
    expect(addressSearchErrorMessage("PLACE_NOT_FOUND")).toBe(ADDRESS_SEARCH_MESSAGES.notFound);
    expect(addressSearchErrorMessage("NETWORK_ERROR")).toBe(ADDRESS_SEARCH_MESSAGES.failed);
  });
});
