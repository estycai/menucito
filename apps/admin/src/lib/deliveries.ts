import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  localDateKey,
  orderStopsByProximity,
  type CourierDelivery,
  type DeliverySummary,
  type LatLng,
  type PublicMenu,
} from "@menucito/shared";
import { api, ApiError } from "./restaurant";

export const DELIVERIES_KEY = ["deliveries"] as const;
export const DELIVERIES_SUMMARY_KEY = ["deliveries", "summary"] as const;
export const DELIVERY_STORE_KEY = ["deliveries", "store"] as const;
/** How often "Mis repartos" refreshes, so a new assignment shows up in seconds. */
export const DELIVERIES_POLL_MS = 5_000;
/** Google Maps accepts an origin plus 10 stops per directions link (decision 18). */
export const GOOGLE_MAPS_MAX_STOPS = 10;

export const DELIVERIES_UI_MESSAGES = {
  listLoadFailed: "No pudimos cargar tus repartos.",
  listRefreshFailed: "No pudimos actualizar tus repartos. Mostramos los últimos que cargamos.",
  summaryLoadFailed: "No pudimos cargar tus números.",
  deliverFailed: "No pudimos marcar el pedido como entregado. Probá de nuevo.",
  deliverGone: "ya no está a tu cargo. Lo sacamos de la lista.",
  empty: "No tenés pedidos en camino.",
  emptyHint: "Cuando te asignen uno, aparece acá.",
} as const;

/** Local calendar days, both inclusive (the API defaults to today when they are missing). */
export interface DateRange {
  from: string;
  to: string;
}

export function todayRange(nowMs = Date.now()): DateRange {
  const today = localDateKey(nowMs);
  return { from: today, to: today };
}

/** The shift that crosses midnight: today until tomorrow, both included (decision 13). */
export function todayAndTomorrowRange(nowMs = Date.now()): DateRange {
  return { from: localDateKey(nowMs), to: localDateKey(nowMs + 24 * 60 * 60 * 1000) };
}

export function deliveriesQueryOptions() {
  return queryOptions({
    queryKey: DELIVERIES_KEY,
    queryFn: () => api<CourierDelivery[]>("/api/deliveries"),
    refetchInterval: DELIVERIES_POLL_MS,
    // The courier comes back from Maps: reload at once instead of waiting for the next poll.
    refetchOnWindowFocus: true,
  });
}

/** The courier's orders on the way (change 13, scenario 25). */
export function useDeliveries() {
  return useQuery(deliveriesQueryOptions());
}

export function deliveriesSummaryPath({ from, to }: DateRange): string {
  const params = new URLSearchParams({ from, to });
  return `/api/deliveries/summary?${params.toString()}`;
}

/** The courier's own delivered orders of the range, today by default (scenario 29). */
export function useDeliveriesSummary(range: DateRange) {
  return useQuery({
    queryKey: [...DELIVERIES_SUMMARY_KEY, range],
    queryFn: () => api<DeliverySummary>(deliveriesSummaryPath(range)),
    refetchInterval: DELIVERIES_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Store location for the route, read from the public menu: a courier's role may have no `store.view`,
 * so `/api/restaurants/me/location` is not an option. `null` for a flat store (no coordinates).
 */
export function useCourierStoreLocation(slug: string | undefined) {
  return useQuery({
    queryKey: [...DELIVERY_STORE_KEY, slug],
    enabled: Boolean(slug),
    queryFn: () => api<PublicMenu>(`/api/public/menus/${encodeURIComponent(slug as string)}`),
    select: (menu) => menu.restaurant.location,
    staleTime: 60_000,
  });
}

/**
 * The API no longer lets this courier deliver the order: it was reassigned (`ORDER_NOT_FOUND`) or it
 * is no longer `sent` (cancelled, or delivered by someone else). It must leave the list.
 */
export function isDeliveryGoneError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "ORDER_NOT_FOUND" || error.code === "INVALID_TRANSITION");
}

/**
 * `POST /api/deliveries/:id/delivered`: the order leaves the list as soon as the API answers, without
 * waiting for the poll (scenario 46), and the day's numbers reload. If the order was reassigned or is
 * no longer `sent`, it also leaves the list: the courier cannot do anything with it anymore.
 */
export function useMarkDelivered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/deliveries/${id}/delivered`, { method: "POST" }),
    onSuccess: (_order, id) => {
      queryClient.setQueryData<CourierDelivery[]>(DELIVERIES_KEY, (previous) =>
        previous?.filter((delivery) => delivery.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: DELIVERIES_SUMMARY_KEY });
    },
    onError: (error, id) => {
      if (!isDeliveryGoneError(error)) return;
      queryClient.setQueryData<CourierDelivery[]>(DELIVERIES_KEY, (previous) =>
        previous?.filter((delivery) => delivery.id !== id),
      );
      // Someone else may have delivered it while it was still on this screen.
      void queryClient.invalidateQueries({ queryKey: DELIVERIES_SUMMARY_KEY });
    },
  });
}

/** Google Maps search link of an order: the pinned point, or the typed address when there is none. */
export function mapsUrlForDelivery(
  delivery: Pick<CourierDelivery, "deliveryAddress" | "deliveryLocation">,
): string | null {
  if (delivery.deliveryLocation) {
    const { lat, lng } = delivery.deliveryLocation;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  if (delivery.deliveryAddress) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.deliveryAddress)}`;
  }
  return null;
}

/** Nearest-neighbour order of the stops, with the ones without coordinates last (decision 18). */
export function sortDeliveriesByProximity(
  store: LatLng | null,
  deliveries: readonly CourierDelivery[],
): CourierDelivery[] {
  const stops = deliveries.map((delivery) => ({
    delivery,
    lat: delivery.deliveryLocation?.lat ?? null,
    lng: delivery.deliveryLocation?.lng ?? null,
  }));
  return orderStopsByProximity(store, stops).map((stop) => stop.delivery);
}

function coord({ lat, lng }: LatLng): string {
  return `${lat},${lng}`;
}

/**
 * Google Maps directions link from the store through the ordered stops (decision 18). Google Maps
 * accepts up to 10 stops per link: with more, the first ten go in the link and the list shows the rest.
 */
export function directionsUrl(store: LatLng | null, deliveries: readonly CourierDelivery[]): string | null {
  if (!store) return null;
  const located = deliveries
    .map((delivery) => delivery.deliveryLocation)
    .filter((location): location is NonNullable<typeof location> => location !== null)
    .slice(0, GOOGLE_MAPS_MAX_STOPS);
  if (located.length === 0) return null;

  const destination = located[located.length - 1]!;
  const waypoints = located.slice(0, -1).map(coord).join("|");
  const base =
    `https://www.google.com/maps/dir/?api=1&origin=${coord(store)}` +
    `&destination=${coord(destination)}`;
  return waypoints ? `${base}&waypoints=${waypoints}&travelmode=driving` : `${base}&travelmode=driving`;
}