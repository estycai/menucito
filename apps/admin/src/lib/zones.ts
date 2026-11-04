import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DeliveryZoneList,
  DeliveryZoneUpsert,
  PlaceResult,
  PlaceSuggestion,
  StoreLocation,
} from "@menucito/shared";
import { api } from "./restaurant";

export type { StoreLocation };

export const STORE_LOCATION_KEY = ["restaurant", "location"] as const;
export const DELIVERY_ZONES_KEY = ["restaurant", "delivery-zones"] as const;

/** The store location and delivery mode (`/location` is the source of truth of the mode). */
export function useStoreLocation() {
  return useQuery({
    queryKey: STORE_LOCATION_KEY,
    queryFn: () => api<StoreLocation>("/api/restaurants/me/location"),
  });
}

export function useUpdateStoreLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (location: StoreLocation) =>
      api<StoreLocation>("/api/restaurants/me/location", { method: "PUT", body: JSON.stringify(location) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(STORE_LOCATION_KEY, updated);
    },
  });
}

export function useDeliveryZones() {
  return useQuery({
    queryKey: DELIVERY_ZONES_KEY,
    queryFn: () => api<DeliveryZoneList>("/api/restaurants/me/delivery-zones"),
  });
}

/** Saves the whole list (in priority order); zones missing from it are deleted. */
export function useSaveDeliveryZones() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (zones: DeliveryZoneUpsert[]) =>
      api<DeliveryZoneList>("/api/restaurants/me/delivery-zones", { method: "PUT", body: JSON.stringify({ zones }) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(DELIVERY_ZONES_KEY, saved);
    },
  });
}

/** Address suggestions for `query`. `session` is one UUID per search flow (Google bills per session). */
export function searchPlaces(query: string, session: string): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, session });
  return api<PlaceSuggestion[]>(`/api/restaurants/me/places/search?${params}`);
}

/** The chosen suggestion with its coordinates; closes the search session. */
export function getPlace(placeId: string, session: string): Promise<PlaceResult> {
  const params = new URLSearchParams({ session });
  return api<PlaceResult>(`/api/restaurants/me/places/${encodeURIComponent(placeId)}?${params}`);
}
