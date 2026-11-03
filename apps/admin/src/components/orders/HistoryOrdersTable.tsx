import {
  FULFILLMENT_LABELS,
  PAYMENT_LABELS,
  formatArs,
  formatLocalDateTime,
  type OrderSummary,
} from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { OrderCard } from "@/components/orders/OrderCard";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { PaymentStatusBadge } from "@/components/orders/PaymentStatusBadge";
import { Button } from "@/components/ui/button";
import { ORDERS_UI_MESSAGES } from "@/lib/orders-messages";

interface HistoryOrdersTableProps {
  /** `undefined` until the first successful load. */
  orders: OrderSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onClearFilters: () => void;
  onSelectOrder: (id: string) => void;
}

/** "Historial" list: a table from 768px, cards below, with "Cargar más" pagination. */
export function HistoryOrdersTable({
  orders,
  isLoading,
  isError,
  isRefetching,
  hasMore,
  isLoadingMore,
  onRetry,
  onLoadMore,
  onClearFilters,
  onSelectOrder,
}: HistoryOrdersTableProps) {
  if (isLoading) {
    return <div className="p-8 text-center text-muted">Cargando pedidos…</div>;
  }

  if (!orders) {
    return isError ? (
      <QueryError message={ORDERS_UI_MESSAGES.listLoadFailed} onRetry={onRetry} retrying={isRefetching} />
    ) : null;
  }

  const staleNotice = isError && (
    <QueryError compact message={ORDERS_UI_MESSAGES.listRefreshFailed} onRetry={onRetry} retrying={isRefetching} />
  );

  if (orders.length === 0) {
    return (
      <>
        {staleNotice}
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
          <p className="m-0 text-base text-ink">No hay pedidos con esos filtros.</p>
          <Button type="button" variant="outline" onClick={onClearFilters} className="min-h-11 px-4 text-sm font-bold">
            Limpiar filtros
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {staleNotice}

      {/* Desktop Table (from 768px) */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-bg/50 text-xs text-muted">
              <th className="px-4 py-3 font-bold">#</th>
              <th className="px-4 py-3 font-bold">Fecha y hora</th>
              <th className="px-4 py-3 font-bold">Cliente</th>
              <th className="px-4 py-3 font-bold">Modalidad</th>
              <th className="px-4 py-3 font-bold">Forma de pago</th>
              <th className="px-4 py-3 font-bold">Total</th>
              <th className="px-4 py-3 font-bold">Estado</th>
              <th className="px-4 py-3 font-bold">Pago</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => onSelectOrder(order.id)}
                className="cursor-pointer transition hover:bg-bg/40"
              >
                <td className="px-4 py-3.5 font-extrabold text-ink">#{order.number}</td>
                <td className="px-4 py-3.5 text-muted">{formatLocalDateTime(order.createdAt)}</td>
                <td className="px-4 py-3.5 font-semibold text-ink">{order.customerName}</td>
                <td className="px-4 py-3.5 text-muted">{FULFILLMENT_LABELS[order.fulfillment]}</td>
                <td className="px-4 py-3.5 text-muted">{PAYMENT_LABELS[order.paymentMethod]}</td>
                <td className="px-4 py-3.5 font-bold text-ink">{formatArs(order.totalCents)}</td>
                <td className="px-4 py-3.5">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-4 py-3.5">
                  <PaymentStatusBadge status={order.paymentStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards (under 768px) */}
      <div className="flex flex-col gap-3 md:hidden">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} onClick={() => onSelectOrder(order.id)} />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="min-h-11 px-6 text-sm font-bold"
          >
            {isLoadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      )}
    </>
  );
}
