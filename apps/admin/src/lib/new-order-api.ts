import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateManualOrderResponse,
  PlaceResult,
  PlaceSuggestion,
  PublicDeliveryQuote,
  PublicMenu,
} from "@menucito/shared";
import { CASH_KEY } from "./cash";
import { ORDERS_KEY } from "./orders";
import { api } from "./restaurant";

export const NEW_ORDER_MENU_KEY = ["new-order", "menu"] as const;
export const NEW_ORDER_QUOTE_KEY = ["new-order", "quote"] as const;

/** Catalog of the popup: the same public menu the diner sees, with availability and ingredients. */
export function useNewOrderMenu(slug: string | null | undefined) {
  return useQuery({
    queryKey: [...NEW_ORDER_MENU_KEY, slug],
    queryFn: () => api<PublicMenu>(`/api/public/menus/${encodeURIComponent(slug!)}`),
    enabled: Boolean(slug),
  });
}

/** `POST /api/orders`: the employee's order. Invalidates the board and the cash, as a web order does. */
export function useCreateManualOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      api<CreateManualOrderResponse>("/api/orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: CASH_KEY });
    },
  });
}

export interface ManualQuoteInput {
  lat: number;
  lng: number;
  subtotalCents: number;
}

/** Shipping of the address selected in the popup, with the current subtotal. */
export function useManualDeliveryQuote(input: ManualQuoteInput | null) {
  return useQuery({
    queryKey: [...NEW_ORDER_QUOTE_KEY, input],
    queryFn: () =>
      api<PublicDeliveryQuote>("/api/orders/delivery-quote", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    enabled: input !== null,
  });
}

/** Address suggestions for the delivery of a manual order. */
export function searchOrderPlaces(query: string, session: string): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, session });
  return api<PlaceSuggestion[]>(`/api/orders/places/search?${params}`);
}

export function getOrderPlace(placeId: string, session: string): Promise<PlaceResult> {
  const params = new URLSearchParams({ session });
  return api<PlaceResult>(`/api/orders/places/${encodeURIComponent(placeId)}?${params}`);
}
