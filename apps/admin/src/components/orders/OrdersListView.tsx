import { useEffect, useState } from "react";
import {
  ACTIVE_ORDER_STATUSES,
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_LABELS,
  type OrderStatus,
  type OrderSummary,
} from "@menucito/shared";
import { formatElapsed } from "@/lib/elapsed";
import { cn } from "@/lib/utils";
import { OrderSourceBadge } from "@/components/orders/OrderSourceBadge";

const EMPTY_MESSAGES: Partial<Record<OrderStatus, string>> = {
  new: "No hay pedidos nuevos",
  preparing: "No hay pedidos en preparación",
  ready: "No hay pedidos listos",
  sent: "No hay pedidos enviados",
};

interface OrdersListViewProps {
  /** Active orders, already filtered by fulfillment. */
  orders: readonly OrderSummary[];
  /** `sent` only exists for delivery stores. */
  deliveryEnabled: boolean;
  onSelectOrder: (id: string) => void;
}

/** "Individual": one list per status, no drag; tapping a row opens the order detail. */
export function OrdersListView({ orders, deliveryEnabled, onSelectOrder }: OrdersListViewProps) {
  const statuses: OrderStatus[] = ACTIVE_ORDER_STATUSES.filter((status) => status !== "sent" || deliveryEnabled);
  const [selected, setSelected] = useState<OrderStatus | null>(null);
  const firstWithOrders = statuses.find((status) => orders.some((order) => order.status === status));
  const current = selected && statuses.includes(selected) ? selected : (firstWithOrders ?? "new");
  const visible = orders.filter((order) => order.status === current);
  // The clock only moves once a minute: no need to re-render on every poll.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Pedidos por estado" className="flex flex-wrap gap-1 rounded-xl bg-tab p-1">
        {statuses.map((status) => {
          const count = orders.filter((order) => order.status === status).length;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={current === status}
              onClick={() => setSelected(status)}
              className={cn(
                "min-h-11 cursor-pointer rounded-lg px-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                current === status ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {count} {ORDER_STATUS_LABELS[status]}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
          {EMPTY_MESSAGES[current] ?? "No hay pedidos"}
        </div>
      ) : (
        <ul role="tabpanel" className="m-0 flex list-none flex-col gap-2 p-0">
          {visible.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => onSelectOrder(order.id)}
                style={{ borderLeftColor: `var(--color-status-${order.status})` }}
                className="flex min-h-14 w-full cursor-pointer flex-col gap-1 rounded-xl border border-line border-l-4 bg-white px-4 py-3 text-left shadow-sm transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="flex items-center gap-2 text-sm font-extrabold text-ink">
                  N°{order.number} {FULFILLMENT_LABELS[order.fulfillment]}
                  <OrderSourceBadge source={order.source} />
                </span>
                <span className="text-xs text-muted">
                  {formatElapsed(now - order.createdAt)} | {PAYMENT_LABELS[order.paymentMethod]} |{" "}
                  {order.customerName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
