import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceResult, PlaceSuggestion, Restaurant, StoreLocation } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";
import { GoogleMapsError, googleMapsClient, type PlacesClient } from "../src/google-maps";
import type { DeliveryRepository } from "../src/repositories/delivery";
import { MapsUnavailableError, PlaceNotFoundError } from "../src/services/errors";
import { createPlacesService } from "../src/services/places";

const KEY = "test-maps-key";
const SESSION = "6f1c2d3e-4b5a-4c6d-8e7f-001122334455";

/** Replaces `fetch` with one answering `responses` in order; returns the spy to inspect the calls. */
function mockFetch(...responses: Response[]) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const response of responses) spy.mockResolvedValueOnce(response);
  return spy;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The `[url, init]` of call `n` of the fetch spy. */
function call(spy: ReturnType<typeof mockFetch>, n = 0) {
  const [input, init] = spy.mock.calls[n] ?? [];
  return { url: String(input), init: init ?? {}, headers: new Headers(init?.headers) };
}

const AUTOCOMPLETE_BODY = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJ-1",
        text: { text: "Av. Corrientes 1234, CABA, Argentina" },
        structuredFormat: { mainText: { text: "Av. Corrientes 1234" }, secondaryText: { text: "CABA, Argentina" } },
      },
    },
    { queryPrediction: { text: { text: "corrientes pizza" } } },
    ...Array.from({ length: 6 }, (_, i) => ({ placePrediction: { placeId: `ChIJ-x${i}`, text: { text: `Calle ${i}` } } })),
  ],
};

const DETAILS_BODY = {
  id: "ChIJ-1",
  formattedAddress: "Av. Corrientes 1234, C1043AAZ CABA, Argentina",
  location: { latitude: -34.6037, longitude: -58.3816 },
  addressComponents: [
    { longText: "1234", types: ["street_number"] },
    { longText: "Comuna 1", types: ["administrative_area_level_2", "political"] },
    { longText: "Buenos Aires", types: ["locality", "political"] },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("googleMapsClient", () => {
  it("fails with not_configured and never calls Google without a key", async () => {
    const spy = mockFetch();
    await expect(googleMapsClient({}).autocomplete({ input: "corrientes", sessionToken: SESSION })).rejects.toMatchObject({
      reason: "not_configured",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("autocomplete posts the session, Argentina and Spanish, biases to the store and keeps 5 place suggestions", async () => {
    const spy = mockFetch(json(AUTOCOMPLETE_BODY));
    const suggestions = await googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).autocomplete({
      input: "corrientes 1234",
      sessionToken: SESSION,
      bias: { lat: -34.6, lng: -58.4 },
    });

    const { url, init, headers } = call(spy);
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(init.method).toBe("POST");
    expect(headers.get("X-Goog-Api-Key")).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      input: "corrientes 1234",
      sessionToken: SESSION,
      includedRegionCodes: ["ar"],
      languageCode: "es",
      locationBias: { circle: { center: { latitude: -34.6, longitude: -58.4 }, radius: 20000 } },
    });

    expect(suggestions).toHaveLength(5);
    expect(suggestions[0]).toEqual({ placeId: "ChIJ-1", mainText: "Av. Corrientes 1234", secondaryText: "CABA, Argentina" });
    expect(suggestions[1]).toEqual({ placeId: "ChIJ-x0", mainText: "Calle 0", secondaryText: "" });
  });

  it("autocomplete sends no bias when there is none", async () => {
    const spy = mockFetch(json({}));
    expect(await googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).autocomplete({ input: "x", sessionToken: SESSION })).toEqual([]);
    expect(JSON.parse(String(call(spy).init.body))).not.toHaveProperty("locationBias");
  });

  it("place details asks only for Essentials fields and reads the locality", async () => {
    const spy = mockFetch(json(DETAILS_BODY));
    const place = await googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).placeDetails({ placeId: "ChIJ-1", sessionToken: SESSION });

    const { url, headers } = call(spy);
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ-1?sessionToken=${SESSION}&languageCode=es`);
    expect(headers.get("X-Goog-FieldMask")).toBe("id,formattedAddress,shortFormattedAddress,location,addressComponents");
    expect(headers.get("X-Goog-Api-Key")).toBe(KEY);
    expect(place).toEqual({
      placeId: "ChIJ-1",
      formattedAddress: "Av. Corrientes 1234, C1043AAZ CABA, Argentina",
      locality: "Buenos Aires",
      lat: -34.6037,
      lng: -58.3816,
    });
  });

  it("place details falls back to the partido when there is no locality", async () => {
    mockFetch(json({ ...DETAILS_BODY, addressComponents: [{ longText: "La Matanza", types: ["administrative_area_level_2"] }] }));
    const place = await googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).placeDetails({ placeId: "ChIJ-1", sessionToken: SESSION });
    expect(place.locality).toBe("La Matanza");
  });

  it("maps a 404 to not_found and other errors to upstream", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(json({ error: { code: 404 } }, 404), json({ error: { code: 403 } }, 403));
    const client = googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY });
    await expect(client.placeDetails({ placeId: "nope", sessionToken: SESSION })).rejects.toMatchObject({ reason: "not_found" });
    await expect(client.autocomplete({ input: "x", sessionToken: SESSION })).rejects.toMatchObject({ reason: "upstream" });
  });

  it("maps a network failure to upstream", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network down"));
    await expect(
      googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).autocomplete({ input: "x", sessionToken: SESSION }),
    ).rejects.toBeInstanceOf(GoogleMapsError);
  });

  it("reverse geocodes with Geocoding v3 and picks the first street-level result", async () => {
    const spy = mockFetch(
      json({
        status: "OK",
        results: [
          { place_id: "plus", types: ["plus_code"], geometry: { location: { lat: 1, lng: 2 } } },
          {
            place_id: "ChIJ-street",
            formatted_address: "Av. Corrientes 1234, CABA",
            types: ["street_address"],
            geometry: { location: { lat: -34.6037, lng: -58.3816 } },
            address_components: [{ long_name: "Buenos Aires", types: ["locality"] }],
          },
        ],
      }),
    );
    const place = await googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY }).reverseGeocode({ lat: -34.6037, lng: -58.3816 });

    const url = new URL(call(spy).url);
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("latlng")).toBe("-34.6037,-58.3816");
    expect(url.searchParams.get("language")).toBe("es");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(place).toEqual({ placeId: "ChIJ-street", formattedAddress: "Av. Corrientes 1234, CABA", locality: "Buenos Aires", lat: -34.6037, lng: -58.3816 });
  });

  it("reverse geocode answers null on ZERO_RESULTS and fails on other statuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(json({ status: "ZERO_RESULTS", results: [] }), json({ status: "REQUEST_DENIED", error_message: "quota" }));
    const client = googleMapsClient({ GOOGLE_MAPS_SERVER_KEY: KEY });
    expect(await client.reverseGeocode({ lat: 0, lng: 0 })).toBeNull();
    await expect(client.reverseGeocode({ lat: 0, lng: 0 })).rejects.toMatchObject({ reason: "upstream" });
  });
});

describe("createPlacesService", () => {

  function deliveryRepo(location: StoreLocation | null) {
    return { findLocation: async () => location } as unknown as DeliveryRepository;
  }

  function fakeClient(overrides: Partial<PlacesClient> = {}): PlacesClient & { lastBias: unknown } {
    const fake = {
      lastBias: undefined as unknown,
      async autocomplete({ bias }: { bias?: unknown }): Promise<PlaceSuggestion[]> {
        fake.lastBias = bias;
        return [{ placeId: "p1", mainText: "Corrientes 1234", secondaryText: "CABA" }];
      },
      async placeDetails(): Promise<PlaceResult> {
        return { placeId: "p1", formattedAddress: "Corrientes 1234", locality: "CABA", lat: -34.6, lng: -58.4 };
      },
      async reverseGeocode() {
        return null;
      },
      ...overrides,
    };
    return fake;
  }

  const located: StoreLocation = { deliveryMode: "flat", address: "Corrientes 1234", addressNotes: null, lat: -34.6, lng: -58.4, placeId: null };

  it("biases the search to the store when it has a location", async () => {
    const client = fakeClient();
    await createPlacesService(deliveryRepo(located), client).search("r1", "corr", SESSION);
    expect(client.lastBias).toEqual({ lat: -34.6, lng: -58.4 });
  });

  it("searches without bias when the store has no location", async () => {
    const client = fakeClient();
    await createPlacesService(deliveryRepo(null), client).search("r1", "corr", SESSION);
    expect(client.lastBias).toBeUndefined();
  });

  it("translates Google failures into domain errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = (reason: "not_found" | "upstream" | "not_configured") =>
      createPlacesService(
        deliveryRepo(null),
        fakeClient({
          placeDetails: async () => {
            throw new GoogleMapsError(reason, reason);
          },
        }),
      );
    await expect(failing("not_found").details("owner", "p1", SESSION)).rejects.toBeInstanceOf(PlaceNotFoundError);
    await expect(failing("upstream").details("owner", "p1", SESSION)).rejects.toBeInstanceOf(MapsUnavailableError);
    await expect(failing("not_configured").details("owner", "p1", SESSION)).rejects.toBeInstanceOf(MapsUnavailableError);
  });
});

describe("/api/restaurants/me/places", () => {
  let sink: ReturnType<typeof captureEmails>;
  beforeEach(() => {
    sink = captureEmails();
  });
  afterEach(() => sink.restore());

  let counter = 0;
  async function ownerClient(bindings = {}) {
    const email = `places${Date.now()}${counter++}@example.com`;
    await new Client().post("/api/auth/sign-up/email", { name: "Marta", email, password: "password-123", callbackURL: "/" });
    const client = new Client(bindings);
    await client.open(sink.last().link);
    const res = await client.post("/api/restaurants", {
      name: "Lo de Marta",
      slug: `places-${Date.now()}${counter++}`,
      whatsapp: "011 15 1234-5678",
      delivery: true,
      takeaway: true,
    });
    expect(res.status).toBe(201);
    (await res.json()) as Restaurant;
    return client;
  }

  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  it("answers 401 without a session", async () => {
    const res = await new Client().get(`/api/restaurants/me/places/search?q=corrientes&session=${SESSION}`);
    expect(res.status).toBe(401);
  });

  it("answers 503 MAPS_UNAVAILABLE when the server key is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = await ownerClient();
    const res = await client.get(`/api/restaurants/me/places/search?q=corrientes&session=${SESSION}`);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("MAPS_UNAVAILABLE");
  });

  it("validates the query, the session and the place id", async () => {
    const client = await ownerClient({ GOOGLE_MAPS_SERVER_KEY: KEY });
    expect((await client.get(`/api/restaurants/me/places/search?session=${SESSION}`)).status).toBe(422);
    expect((await client.get("/api/restaurants/me/places/search?q=corrientes")).status).toBe(422);
    expect((await client.get(`/api/restaurants/me/places/bad.id?session=${SESSION}`)).status).toBe(422);
  });

  it("searches and resolves a place through Google", async () => {
    const client = await ownerClient({ GOOGLE_MAPS_SERVER_KEY: KEY });
    const spy = mockFetch(json(AUTOCOMPLETE_BODY), json(DETAILS_BODY));

    const search = await client.get(`/api/restaurants/me/places/search?q=corrientes&session=${SESSION}`);
    expect(search.status).toBe(200);
    expect(((await search.json()) as PlaceSuggestion[])[0]?.placeId).toBe("ChIJ-1");

    const details = await client.get(`/api/restaurants/me/places/ChIJ-1?session=${SESSION}`);
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({ placeId: "ChIJ-1", locality: "Buenos Aires", lat: -34.6037 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("answers 404 PLACE_NOT_FOUND for a place Google does not know", async () => {
    const client = await ownerClient({ GOOGLE_MAPS_SERVER_KEY: KEY });
    mockFetch(json({ error: { code: 404 } }, 404));
    const res = await client.get(`/api/restaurants/me/places/ChIJ-gone?session=${SESSION}`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("PLACE_NOT_FOUND");
  });
});
