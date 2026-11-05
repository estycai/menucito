import {
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  formatArs,
  formatLocalTime,
  type OrderSummary,
} from "@menucito/shared";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { Badge } from "@/components/ui/badge";
import { courierName } from "@/lib/couriers";

export const ORDER_CARD_CLASS =
  "flex min-h-[44px] cursor-pointer flex-col gap-2 rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary";

/** Order card of the mobile history list: it mixes statuses, so it shows the colored status. */
export function OrderCard({ order, onClick }: { order: OrderSummary; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ORDER_CARD_CLASS}>
      <OrderCardContent order={order} showStatus />
    </button>
  );
}

/** `showStatus` is for lists that mix statuses (history); on the board the column already says it. */
export function OrderCardContent({ order, showStatus = false }: { order: OrderSummary; showStatus?: boolean }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-extrabold text-ink">#{order.number}</span>
        <span className="flex items-center gap-2">
          {showStatus && <OrderStatusBadge status={order.status} />}
          <span className="text-xs text-muted">{formatLocalTime(order.createdAt)}</span>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-ink">{order.customerName}</span>
        <Badge tone="subtle">{FULFILLMENT_LABELS[order.fulfillment]}</Badge>
      </div>

      {order.courier && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">Repartidor</span>
          <span className="truncate font-bold text-ink">{courierName(order.courier)}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-2 text-xs">
        <span className="text-muted">
          {PAYMENT_LABELS[order.paymentMethod]} ·{" "}
          <strong className={order.paymentStatus === "paid" ? "text-success" : "text-ink"}>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </strong>
        </span>
        <span className="font-extrabold text-ink">{formatArs(order.totalCents)}</span>
      </div>
    </>
  );
}
