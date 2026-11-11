import type { LatLng, PlaceResult, PlaceSuggestion } from "@menucito/shared";
import type { Env } from "./env";

/**
 * Thin client of the Google Maps web services the project's quota allows: Places API (New)
 * Autocomplete and Place Details, and Geocoding API v3. Any other endpoint is rejected by the quota.
 */

type GoogleMapsEnv = Pick<Env, "GOOGLE_MAPS_SERVER_KEY">;

/**
 * - `not_configured`: no server key (local dev without it, or a missing secret).
 * - `not_found`: Google does not know the place id.
 * - `upstream`: Google answered with an error or could not be reached.
 */
export type GoogleMapsFailure = "not_configured" | "not_found" | "upstream";

export class GoogleMapsError extends Error {
  constructor(
    readonly reason: GoogleMapsFailure,
    message: string,
  ) {
    super(message);
    this.name = "GoogleMapsError";
  }
}

export interface AutocompleteRequest {
  input: string;
  /** One UUID per search flow (autocomplete calls + the details of the chosen place). */
  sessionToken: string;
  /** Prefer results near this point (usually the store). */
  bias?: LatLng;
}

export interface PlaceDetailsRequest {
  placeId: string;
  sessionToken: string;
}

export interface GeocodeRequest {
  address: string;
  /** Prefer results near this point (usually the store). */
  bias?: LatLng;
}

/** What the services need from Google; tests swap it for a fake. */
export interface PlacesClient {
  autocomplete(request: AutocompleteRequest): Promise<PlaceSuggestion[]>;
  placeDetails(request: PlaceDetailsRequest): Promise<PlaceResult>;
  reverseGeocode(point: LatLng): Promise<PlaceResult | null>;
  /** Forward geocoding of a typed address; `null` when Google has no street-level result. */
  geocode(request: GeocodeRequest): Promise<PlaceResult | null>;
}

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const MAX_SUGGESTIONS = 5;
const BIAS_RADIUS_M = 20_000;
/** Half side of the box around the store used as a geocoding bias, in degrees (~22 km). */
const GEOCODE_BIAS_DEGREES = 0.2;

/**
 * Only fields billed as Place Details Essentials (`id` is Essentials IDs Only). Asking for any Pro or
 * Enterprise field (displayName, rating, ...) would bill the whole request at that tier.
 */
const PLACE_DETAILS_FIELD_MASK = "id,formattedAddress,shortFormattedAddress,location,addressComponents";

/** Geocoding result types that point at a building or, at worst, a street. */
const STREET_LEVEL_TYPES = ["street_address", "premise", "route"];

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
}

interface PlaceDetailsResponse {
  id?: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: { longText?: string; types?: string[] }[];
}

interface GeocodeResponse {
  status?: string;
  error_message?: string;
  results?: {
    place_id?: string;
    formatted_address?: string;
    types?: string[];
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: { long_name?: string; types?: string[] }[];
  }[];
}

/** City of an address: `locality`, else the partido (`administrative_area_level_2`). */
function localityOf(components: readonly { name?: string; types?: string[] }[]): string | null {
  const byType = (type: string) => components.find((component) => component.types?.includes(type))?.name;
  return byType("locality") ?? byType("administrative_area_level_2") ?? null;
}

function requireKey(env: GoogleMapsEnv): string {
  if (!env.GOOGLE_MAPS_SERVER_KEY) throw new GoogleMapsError("not_configured", "GOOGLE_MAPS_SERVER_KEY is not set");
  return env.GOOGLE_MAPS_SERVER_KEY;
}

/** Runs the request; network failures and non-2xx answers become `GoogleMapsError`. */
async function send(url: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new GoogleMapsError("upstream", `${what} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (res.status === 404) throw new GoogleMapsError("not_found", `${what} answered 404`);
  if (!res.ok) {
    // The body names the problem (quota, key restrictions, ...); it carries no customer data.
    console.error(`[google-maps] ${what} responded ${res.status}: ${await res.text().catch(() => "")}`);
    throw new GoogleMapsError("upstream", `${what} answered ${res.status}`);
  }
  return res;
}

export function googleMapsClient(env: GoogleMapsEnv): PlacesClient {
  return {
    async autocomplete({ input, sessionToken, bias }) {
      const key = requireKey(env);
      const body = {
        input,
        sessionToken,
        includedRegionCodes: ["ar"],
        languageCode: "es",
        ...(bias && {
          locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: BIAS_RADIUS_M } },
        }),
      };
      const res = await send(
        AUTOCOMPLETE_URL,
        { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key }, body: JSON.stringify(body) },
        "Places autocomplete",
      );
      const data = (await res.json()) as AutocompleteResponse;

      const suggestions: PlaceSuggestion[] = [];
      for (const { placePrediction: prediction } of data.suggestions ?? []) {
        // Query predictions (no place id) cannot be resolved to coordinates, so they are skipped.
        if (!prediction?.placeId) continue;
        suggestions.push({
          placeId: prediction.placeId,
          mainText: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
          secondaryText: prediction.structuredFormat?.secondaryText?.text ?? "",
        });
        if (suggestions.length === MAX_SUGGESTIONS) break;
      }
      return suggestions;
    },

    async placeDetails({ placeId, sessionToken }) {
      const key = requireKey(env);
      const params = new URLSearchParams({ sessionToken, languageCode: "es" });
      const res = await send(
        `${PLACE_DETAILS_URL}${encodeURIComponent(placeId)}?${params}`,
        { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK } },
        "Place details",
      );
      const data = (await res.json()) as PlaceDetailsResponse;
      const lat = data.location?.latitude;
      const lng = data.location?.longitude;
      if (lat === undefined || lng === undefined) throw new GoogleMapsError("upstream", "Place details without a location");

      return {
        placeId: data.id ?? placeId,
        formattedAddress: data.formattedAddress ?? data.shortFormattedAddress ?? "",
        locality: localityOf((data.addressComponents ?? []).map((c) => ({ name: c.longText, types: c.types }))),
        lat,
        lng,
      };
    },

    async reverseGeocode({ lat, lng }) {
      const key = requireKey(env);
      const params = new URLSearchParams({ latlng: `${lat},${lng}`, language: "es", key });
      const res = await send(`${GEOCODE_URL}?${params}`, {}, "Reverse geocode");
      const data = (await res.json()) as GeocodeResponse;
      // v3 answers 200 with a `status`: ZERO_RESULTS is an empty answer, anything else but OK an error.
      if (data.status === "ZERO_RESULTS") return null;
      if (data.status !== "OK") {
        console.error(`[google-maps] Reverse geocode status ${data.status}: ${data.error_message ?? ""}`);
        throw new GoogleMapsError("upstream", `Reverse geocode status ${data.status}`);
      }

      const result = data.results?.find((candidate) => candidate.types?.some((type) => STREET_LEVEL_TYPES.includes(type)));
      const location = result?.geometry?.location;
      if (!result?.place_id || location?.lat === undefined || location.lng === undefined) return null;
      return {
        placeId: result.place_id,
        formattedAddress: result.formatted_address ?? "",
        locality: localityOf((result.address_components ?? []).map((c) => ({ name: c.long_name, types: c.types }))),
        lat: location.lat,
        lng: location.lng,
      };
    },

    async geocode({ address, bias }) {
      const key = requireKey(env);
      const params = new URLSearchParams({ address, language: "es", region: "ar", key });
      if (bias) {
        params.set(
          "bounds",
          `${bias.lat - GEOCODE_BIAS_DEGREES},${bias.lng - GEOCODE_BIAS_DEGREES},${bias.lat + GEOCODE_BIAS_DEGREES},${bias.lng + GEOCODE_BIAS_DEGREES}`,
        );
      }
      const res = await send(`${GEOCODE_URL}?${params}`, {}, "Geocode");
      const data = (await res.json()) as GeocodeResponse;
      if (data.status === "ZERO_RESULTS") return null;
      if (data.status !== "OK") {
        console.error(`[google-maps] Geocode status ${data.status}: ${data.error_message ?? ""}`);
        throw new GoogleMapsError("upstream", `Geocode status ${data.status}`);
      }
      const result = data.results?.find((candidate) => candidate.types?.some((type) => STREET_LEVEL_TYPES.includes(type)));
      const location = result?.geometry?.location;
      if (!result?.place_id || location?.lat === undefined || location.lng === undefined) return null;
      return {
        placeId: result.place_id,
        formattedAddress: result.formatted_address ?? address,
        locality: localityOf((result.address_components ?? []).map((c) => ({ name: c.long_name, types: c.types }))),
        lat: location.lat,
        lng: location.lng,
      };
    },
  };
}
