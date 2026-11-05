import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type {
  CourierFilterOption,
  CourierOption,
  CourierSummary,
  CourierSummaryRow,
  CourierSummaryStatus,
} from "@menucito/shared";
import { ApiError, api } from "./restaurant";
import { ordersPollInterval } from "./orders";
import { ORDERS_UI_MESSAGES } from "./orders-messages";

export const COURIERS_KEY = ["couriers"] as const;
export const COURIERS_SUMMARY_KEY = ["couriers", "summary"] as const;

/** Active couriers of the local, with the orders each one has on the way (change 13, scenario 14). */
export function couriersQueryOptions() {
  return queryOptions({
    queryKey: COURIERS_KEY,
    queryFn: () => api<CourierOption[]>("/api/couriers"),
  });
}

/** `enabled` is false for a member without `orders.assign`: the picker is never opened without it. */
export function useCouriers(enabled = true) {
  return useQuery({ ...couriersQueryOptions(), enabled });
}

/** `GET /api/couriers/summary`: the delivered orders of the range, grouped by courier (scenario 30). */
export function courierSummaryPath(from: string, to: string, status: CourierSummaryStatus = "delivered"): string {
  const params = new URLSearchParams({ from, to, status });
  return `/api/couriers/summary?${params.toString()}`;
}

/** Daily numbers by courier; `couriers.view` is required, so the guarded page enables it. */
export function useCourierSummary(from: string, to: string, status: CourierSummaryStatus = "delivered", enabled = true) {
  return useQuery({
    queryKey: [...COURIERS_SUMMARY_KEY, from, to, status],
    queryFn: () => api<CourierSummary>(courierSummaryPath(from, to, status)),
    // Keep the table on screen while another status or range loads.
    placeholderData: keepPreviousData,
    enabled,
    // Same pace as the board: a courier's delivery shows up here in seconds, also with the tab hidden.
    refetchInterval: ordersPollInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Keeps every row for "Todos" (`""`/`null`), or only the chosen courier's. When the range has no
 * deliveries of the chosen courier, his zero row is built from the stable filter options, so the
 * selection keeps showing him instead of going blank.
 */
export function filterCourierRows(
  rows: readonly CourierSummaryRow[],
  courierMemberId: string | null,
  couriers: readonly CourierFilterOption[] = [],
): CourierSummaryRow[] {
  if (!courierMemberId) return [...rows];
  const chosen = rows.filter((row) => row.memberId === courierMemberId);
  if (chosen.length > 0) return chosen;
  const option = couriers.find((courier) => courier.memberId === courierMemberId);
  return option ? [{ ...option, delivered: 0, inProgress: 0, shippingCents: 0, tipCents: 0 }] : [];
}

/** Totals of the rows on screen, so they follow the filter (the design's three cards). */
export function courierTotals(rows: readonly CourierSummaryRow[]): {
  delivered: number;
  inProgress: number;
  shippingCents: number;
  tipCents: number;
} {
  return rows.reduce(
    (sum, row) => ({
      delivered: sum.delivered + row.delivered,
      inProgress: sum.inProgress + row.inProgress,
      shippingCents: sum.shippingCents + row.shippingCents,
      tipCents: sum.tipCents + row.tipCents,
    }),
    { delivered: 0, inProgress: 0, shippingCents: 0, tipCents: 0 },
  );
}

/** Full name of a courier option or summary row. "Sin repartidor" when the row has no courier. */
export function courierName(courier: { firstName: string | null; lastName: string | null }): string {
  return `${courier.firstName ?? ""} ${courier.lastName ?? ""}`.trim() || "Sin repartidor";
}

/** "Libre", "1 en camino" or "N en camino" (the pill of the courier picker, change 13 scenario 39). */
export function inProgressText(count: number): string {
  if (count === 0) return "Libre";
  return count === 1 ? "1 en camino" : `${count} en camino`;
}
/** Why `POST /api/orders/:id/assign` failed, in words the board can act on (change 13). */
export const ASSIGN_ERROR_MESSAGES = {
  courierUnavailable: "Ese repartidor ya no está disponible. Elegí otro de la lista.",
  orderChanged: "El pedido cambió mientras elegías (lo cancelaron o lo movieron). Cerrá y revisalo.",
  concurrent: "Alguien asignó este pedido al mismo tiempo. Cerrá y revisá quién lo lleva.",
  orderGone: "El pedido ya no existe. Recargá la página.",
} as const;

/** Message of a failed assignment; anything unexpected keeps the generic "Probá de nuevo". */
export function assignFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "VALIDATION_ERROR":
        return ASSIGN_ERROR_MESSAGES.courierUnavailable;
      case "INVALID_TRANSITION":
        return ASSIGN_ERROR_MESSAGES.orderChanged;
      case "CONCURRENT_MODIFICATION":
        return ASSIGN_ERROR_MESSAGES.concurrent;
      case "ORDER_NOT_FOUND":
        return ASSIGN_ERROR_MESSAGES.orderGone;
    }
  }
  return ORDERS_UI_MESSAGES.assignFailed;
}
