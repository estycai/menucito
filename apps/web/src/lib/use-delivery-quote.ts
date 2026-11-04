import { useEffect, useState } from "preact/hooks";
import type { LatLng } from "@menucito/shared";
import { fetchDeliveryQuote, type QuoteState } from "./delivery-address";

/** Wait after the last cart change before quoting again, so a few taps on a stepper make one call. */
const QUOTE_DEBOUNCE_MS = 300;

export interface UseDeliveryQuoteOptions {
  apiUrl: string;
  slug: string;
  /** The confirmed address; `null` (or `enabled: false`) means there is nothing to quote. */
  point: LatLng | null;
  subtotalCents: number;
  enabled: boolean;
}

/**
 * Quote of the confirmed address, refreshed whenever the address or the subtotal changes (free
 * shipping and the zone minimum depend on it). Older answers never overwrite a newer one.
 */
export function useDeliveryQuote({ apiUrl, slug, point, subtotalCents, enabled }: UseDeliveryQuoteOptions): {
  quote: QuoteState;
  retry: () => void;
} {
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const lat = point?.lat;
  const lng = point?.lng;

  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined) {
      setQuote({ status: "idle" });
      return;
    }
    setQuote({ status: "loading" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await fetchDeliveryQuote(apiUrl, slug, { lat, lng, subtotalCents }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setQuote(result.ok ? { status: "ready", quote: result.data } : { status: "error" });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, slug, lat, lng, subtotalCents, enabled, attempt]);

  return { quote, retry: () => setAttempt((n) => n + 1) };
}
