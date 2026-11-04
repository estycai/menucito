import { FULFILLMENT_LABELS, formatArs, type OrderSummary } from "@menucito/shared";

/** How long a new-order toast stays on screen (spec 11b, scenario 20); the Toaster's default. */
export const NEW_ORDER_TOAST_MS = 8000;

/**
 * Orders in `orders` whose id is not in `seenIds`. `null` means "first load": what is already there
 * is not new, but the very first order arriving on an empty board is (scenario 41). Orders that
 * left the list are simply not in `orders`, so they never count.
 */
export function findNewOrders<T extends { id: string }>(seenIds: ReadonlySet<string> | null, orders: ReadonlyArray<T>): T[] {
  if (seenIds === null) return [];
  return orders.filter((order) => !seenIds.has(order.id));
}

/** Where a new-order toast takes the owner: the "Activos" board, opening one order when there is one. */
export interface OrdersNavigationState {
  showActiveOrders: true;
  openOrderId?: string;
}

/** The router state a new-order toast set, or `null` for any other (or no) state. Same reference, so it is stable. */
export function ordersNavigationState(state: unknown): OrdersNavigationState | null {
  if (!state || typeof state !== "object") return null;
  const candidate = state as Partial<OrdersNavigationState>;
  if (candidate.showActiveOrders !== true) return null;
  if (candidate.openOrderId !== undefined && typeof candidate.openOrderId !== "string") return null;
  return candidate as OrdersNavigationState;
}

export interface NewOrdersToast {
  title: string;
  description?: string;
  actionLabel: string;
  target: OrdersNavigationState;
}

type ToastOrder = Pick<OrderSummary, "id" | "number" | "customerName" | "fulfillment" | "totalCents">;

/**
 * Toast for the orders found by one poll: the order itself when there is one, a single summary
 * when several arrived together (spec 11b, scenario 19), `null` when none did.
 */
export function newOrdersToast(orders: ReadonlyArray<ToastOrder>): NewOrdersToast | null {
  const [first] = orders;
  if (!first) return null;
  if (orders.length > 1) {
    return {
      title: `Llegaron ${orders.length} pedidos nuevos`,
      actionLabel: "Ver pedidos",
      target: { showActiveOrders: true },
    };
  }
  return {
    title: `Nuevo pedido #${first.number}`,
    description: `${first.customerName} · ${FULFILLMENT_LABELS[first.fulfillment]} · ${formatArs(first.totalCents)}`,
    actionLabel: "Ver pedido",
    target: { showActiveOrders: true, openOrderId: first.id },
  };
}
