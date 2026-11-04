import {
  ACTIVE_ORDER_STATUSES,
  type OrderMapPoint,
  type OrderStatus,
  type OrderSummary,
  type PaymentMethod,
} from "@menucito/shared";

/** Search param of the "Activos" view: `?vista=mapa` shows the map instead of the board. */
export const ORDERS_VIEW_PARAM = "vista";
export const ORDERS_MAP_VIEW = "mapa";

/**
 * "pending": only the active orders. "today": the whole board, so today's delivered orders too
 * (the same approximation as the "Entregados" column).
 */
export type MapScope = "pending" | "today";

export interface MapFilters {
  /** Empty means every status. */
  statuses: OrderStatus[];
  paymentMethod: PaymentMethod | "";
  zone: string;
  scope: MapScope;
}

export const DEFAULT_MAP_FILTERS: MapFilters = { statuses: [], paymentMethod: "", zone: "", scope: "pending" };

/** An order with the point it goes to. */
export type MappedOrder = OrderSummary & { deliveryLocation: OrderMapPoint };

/** Marker fill of each status: the solid status tokens of index.css (delivered uses the muted gray). */
export const ORDER_STATUS_MARKER_COLORS: Readonly<Record<OrderStatus, string>> = {
  new: "#1e40af",
  preparing: "#5b21b6",
  ready: "#115e59",
  sent: "#86198f",
  delivered: "#78716c",
  cancelled: "#b91c1c",
};

const isActive = (status: OrderStatus) => (ACTIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);

/** The board's orders that pass `filters`, in the given order. */
export function filterMapOrders(orders: readonly OrderSummary[], filters: MapFilters): OrderSummary[] {
  return orders.filter(
    (order) =>
      (filters.scope === "today" || isActive(order.status)) &&
      (filters.statuses.length === 0 || filters.statuses.includes(order.status)) &&
      (!filters.paymentMethod || order.paymentMethod === filters.paymentMethod) &&
      (!filters.zone || order.deliveryLocation?.zoneName === filters.zone),
  );
}

/** Splits `orders` into the ones with a point (the map) and the rest (the side list). */
export function splitByLocation(orders: readonly OrderSummary[]): { mapped: MappedOrder[]; unmapped: OrderSummary[] } {
  const mapped: MappedOrder[] = [];
  const unmapped: OrderSummary[] = [];
  for (const order of orders) {
    if (order.deliveryLocation) mapped.push(order as MappedOrder);
    else unmapped.push(order);
  }
  return { mapped, unmapped };
}

/** Zone names present in `orders`, sorted, for the zone filter. */
export function zoneNamesOf(orders: readonly OrderSummary[]): string[] {
  const names = new Set<string>();
  for (const order of orders) {
    const name = order.deliveryLocation?.zoneName;
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "es"));
}

/** `statuses` with `status` added or removed. */
export function toggleStatus(statuses: readonly OrderStatus[], status: OrderStatus): OrderStatus[] {
  return statuses.includes(status) ? statuses.filter((s) => s !== status) : [...statuses, status];
}

/** Board orders without duplicates: an order delivered a moment ago can be in both lists until they refetch. */
export function mergeBoardOrders(active: readonly OrderSummary[], delivered: readonly OrderSummary[]): OrderSummary[] {
  const ids = new Set(active.map((o) => o.id));
  return [...active, ...delivered.filter((o) => !ids.has(o.id))];
}
