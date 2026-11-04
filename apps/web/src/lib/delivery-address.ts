import type {
  AddressLabel,
  ApiErrorBody,
  DeliveryQuoteRequest,
  LatLng,
  OrderDelivery,
  PlaceResult,
  PlaceSuggestion,
  PublicDeliveryQuote,
} from "@menucito/shared";

/**
 * Delivery address of stores in `zones` mode: the calls of the address search and the quote, and the
 * pure helpers the address card and dialog render with. Nothing here is persisted in the browser.
 */

/** How long a search, reverse geocode or quote may take before it counts as a network error. */
export const DELIVERY_REQUEST_TIMEOUT_MS = 10000;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

async function requestJson<T>(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_REQUEST_TIMEOUT_MS);
  // A caller's abort (a newer quote replaced this one) also cancels the request.
  init.signal?.addEventListener("abort", () => controller.abort());
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, status: res.status, code: err?.error?.code ?? "UNKNOWN" };
  } catch {
    return { ok: false, status: 0, code: "NETWORK_ERROR" };
  } finally {
    clearTimeout(timeoutId);
  }
}

const menuPath = (apiUrl: string, slug: string) => `${apiUrl}/api/public/menus/${slug}`;

/** Up to 5 addresses matching `query`, near the store. `session` groups one search flow for billing. */
export function searchPlaces(apiUrl: string, slug: string, query: string, session: string, fetchImpl: typeof fetch = fetch) {
  const params = new URLSearchParams({ q: query, session });
  return requestJson<PlaceSuggestion[]>(`${menuPath(apiUrl, slug)}/places/search?${params}`, {}, fetchImpl);
}

/** Coordinates of a chosen suggestion; closes the search session `session`. */
export function getPlace(apiUrl: string, slug: string, placeId: string, session: string, fetchImpl: typeof fetch = fetch) {
  const params = new URLSearchParams({ session });
  return requestJson<PlaceResult>(`${menuPath(apiUrl, slug)}/places/${encodeURIComponent(placeId)}?${params}`, {}, fetchImpl);
}

/** The street address under the map pin (keeping the pin's coordinates). */
export function reversePlace(apiUrl: string, slug: string, point: LatLng, fetchImpl: typeof fetch = fetch) {
  const params = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
  return requestJson<PlaceResult>(`${menuPath(apiUrl, slug)}/places/reverse?${params}`, {}, fetchImpl);
}

/** Whether the store delivers to the point and what it costs with this subtotal. */
export function fetchDeliveryQuote(
  apiUrl: string,
  slug: string,
  request: DeliveryQuoteRequest,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
) {
  return requestJson<PublicDeliveryQuote>(
    `${menuPath(apiUrl, slug)}/delivery-quote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    },
    options.fetchImpl ?? fetch,
  );
}

export const ADDRESS_SEARCH_MESSAGES = {
  failed: "No pudimos buscar la dirección. Probá de nuevo.",
  unavailable: "La búsqueda de direcciones no está disponible. Probá de nuevo en unos minutos.",
  rateLimited: "Hiciste muchas búsquedas seguidas. Probá de nuevo en unos minutos.",
  notFound: "No encontramos esa dirección. Probá ubicarla en el mapa.",
  noResults: "No encontramos direcciones con ese texto.",
  pinNotFound: "No encontramos una dirección en ese punto. Mové el mapa un poco.",
  quoteFailed: "No pudimos calcular el envío.",
  mapFailed: "No pudimos cargar el mapa. Probá de nuevo más tarde.",
  geolocationFailed: "No pudimos obtener tu ubicación.",
} as const;

/** What to tell the diner when the address search fails with `code`. */
export function addressSearchErrorMessage(code: string): string {
  switch (code) {
    case "RATE_LIMITED":
      return ADDRESS_SEARCH_MESSAGES.rateLimited;
    case "MAPS_UNAVAILABLE":
      return ADDRESS_SEARCH_MESSAGES.unavailable;
    case "PLACE_NOT_FOUND":
      return ADDRESS_SEARCH_MESSAGES.notFound;
    default:
      return ADDRESS_SEARCH_MESSAGES.failed;
  }
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Lowercase without accents, so "Peña" matches "pena". */
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * `text` split into the parts that match a word of `query` (to show in bold) and the rest. Matching
 * ignores case and accents; every occurrence of every word is marked and adjacent marks merge.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const chars = Array.from(text);
  const words = [...new Set(fold(query).split(/[\s,]+/).filter(Boolean))];

  // Fold char by char and remember where each one starts, so matches map back to the original text
  // even when folding changes a char's length.
  const starts: number[] = [];
  let haystack = "";
  for (const char of chars) {
    starts.push(haystack.length);
    haystack += fold(char);
  }

  const marked = chars.map(() => false);
  for (const word of words) {
    for (let from = haystack.indexOf(word); from !== -1; from = haystack.indexOf(word, from + 1)) {
      const to = from + word.length;
      starts.forEach((start, i) => {
        const end = starts[i + 1] ?? haystack.length;
        if (start < to && end > from) marked[i] = true;
      });
    }
  }

  const segments: HighlightSegment[] = [];
  chars.forEach((char, i) => {
    const match = marked[i] ?? false;
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += char;
    else segments.push({ text: char, match });
  });
  return segments;
}

/** The card's two lines: street and number in bold, then the locality (or the rest of the address). */
export function addressLines(address: Pick<OrderDelivery, "formattedAddress" | "locality">): { main: string; secondary: string } {
  const [main = "", ...rest] = address.formattedAddress.split(",").map((part) => part.trim());
  return { main, secondary: address.locality ?? rest.filter(Boolean).join(", ") };
}

export interface AddressDetailsInput {
  label: AddressLabel | null;
  betweenStreets: string;
  unit: string;
}

/** The order's `delivery` from the resolved place and what the diner added; empty texts are `null`. */
export function toOrderDelivery(place: PlaceResult, details: AddressDetailsInput): OrderDelivery {
  return {
    placeId: place.placeId || null,
    lat: place.lat,
    lng: place.lng,
    formattedAddress: place.formattedAddress,
    locality: place.locality,
    unit: details.unit.trim() || null,
    betweenStreets: details.betweenStreets.trim() || null,
    label: details.label,
  };
}

/** Whether two points are the same spot for the address search (about a meter apart at most). */
export function sameSpot(a: LatLng | null, b: LatLng): boolean {
  return a !== null && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; quote: PublicDeliveryQuote };

export interface DeliveryPricing {
  shippingCents: number;
  minOrderCents: number | null;
  /** `true`/`false` once the quote is known, `null` while there is none (no address, loading, error). */
  covered: boolean | null;
}

/**
 * Shipping and minimum of the order summary. `flat` stores use their own values; in `zones` mode the
 * quote prices the address and its minimum, when the zone has one, replaces the store's.
 */
export function deliveryPricing(
  zones: boolean,
  quote: QuoteState,
  store: { shippingCents: number; minOrderCents: number | null },
): DeliveryPricing {
  if (!zones) return { ...store, covered: null };
  if (quote.status !== "ready") return { shippingCents: 0, minOrderCents: store.minOrderCents, covered: null };
  if (!quote.quote.covered) return { shippingCents: 0, minOrderCents: store.minOrderCents, covered: false };
  return {
    shippingCents: quote.quote.shippingCents,
    minOrderCents: quote.quote.minOrderCents ?? store.minOrderCents,
    covered: true,
  };
}
