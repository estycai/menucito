import { useId, useState, type ReactNode } from "react";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  hasCoordinates,
  type OrderSummary,
  type PaymentMethod,
} from "@menucito/shared";
import { QueryError } from "@/components/QueryError";
import { OrderCard } from "@/components/orders/OrderCard";
import { OrdersMap } from "@/components/orders/OrdersMap";
import { BOARD_COLUMNS } from "@/lib/board-dnd";
import {
  DEFAULT_MAP_FILTERS,
  ORDER_STATUS_MARKER_COLORS,
  filterMapOrders,
  mergeBoardOrders,
  splitByLocation,
  toggleStatus,
  zoneNamesOf,
  type MapFilters,
  type MapScope,
} from "@/lib/orders-map";
import { ORDERS_UI_MESSAGES } from "@/lib/orders-messages";
import { useStoreLocation } from "@/lib/zones";
import { cn } from "@/lib/utils";

const CONTROL_CLASS =
  "box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

interface OrdersMapViewProps {
  /** `undefined` until the first successful load. */
  orders: OrderSummary[] | undefined;
  deliveredOrders: OrderSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  deliveredError: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
  onSelectOrder: (id: string) => void;
}

/** "Activos" as a map: the board's orders with a delivery point, plus a list of the ones without. */
export function OrdersMapView({
  orders,
  deliveredOrders = [],
  isLoading,
  isError,
  deliveredError,
  isRefetching,
  onRefresh,
  onSelectOrder,
}: OrdersMapViewProps) {
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_MAP_FILTERS);
  const locationQuery = useStoreLocation();

  if (isLoading || locationQuery.isLoading) {
    return <div className="p-8 text-center text-muted">Cargando pedidos…</div>;
  }

  if (!orders) {
    return isError ? (
      <QueryError message={ORDERS_UI_MESSAGES.listLoadFailed} onRetry={onRefresh} retrying={isRefetching} />
    ) : null;
  }

  const boardOrders = mergeBoardOrders(orders, deliveredOrders);
  const { mapped, unmapped } = splitByLocation(filterMapOrders(boardOrders, filters));
  const store = locationQuery.data && hasCoordinates(locationQuery.data) ? locationQuery.data : null;
  const takeaway = unmapped.filter((o) => o.fulfillment === "takeaway");
  const deliveryWithoutPoint = unmapped.filter((o) => o.fulfillment === "delivery");

  return (
    <div className="flex flex-col gap-4">
      {(isError || deliveredError) && (
        <QueryError compact message={ORDERS_UI_MESSAGES.listRefreshFailed} onRetry={onRefresh} retrying={isRefetching} />
      )}

      <MapFiltersBar filters={filters} zones={zoneNamesOf(boardOrders)} onChange={setFilters} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-2">
          <OrdersMap store={store} orders={mapped} onSelectOrder={onSelectOrder} />
          {store && (
            <p className="m-0 text-xs text-muted">
              {mapped.length === 0
                ? "No hay pedidos con ubicación para estos filtros."
                : `${mapped.length} ${mapped.length === 1 ? "pedido" : "pedidos"} en el mapa. Tocá uno para ver el detalle.`}
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Pedidos sin ubicación en el mapa">
          <UnmappedGroup title="Para retirar" orders={takeaway} onSelectOrder={onSelectOrder} />
          <UnmappedGroup title="Envíos sin ubicación" orders={deliveryWithoutPoint} onSelectOrder={onSelectOrder} />
          {unmapped.length === 0 && (
            <p className="m-0 rounded-2xl border border-line bg-white p-4 text-center text-sm text-muted">
              Todos los pedidos están en el mapa.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function UnmappedGroup({
  title,
  orders,
  onSelectOrder,
}: {
  title: string;
  orders: OrderSummary[];
  onSelectOrder: (id: string) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-extrabold text-ink">
        {title} ({orders.length})
      </h2>
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} onClick={() => onSelectOrder(order.id)} />
      ))}
    </section>
  );
}

const SCOPES: Array<{ id: MapScope; label: string }> = [
  { id: "pending", label: "Solo pendientes" },
  { id: "today", label: "Hoy (con entregados)" },
];

function MapFiltersBar({
  filters,
  zones,
  onChange,
}: {
  filters: MapFilters;
  zones: string[];
  onChange: (filters: MapFilters) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-xs font-bold text-muted">Estado</legend>
        <div className="flex flex-wrap gap-2">
          {BOARD_COLUMNS.map(({ status }) => {
            const selected = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...filters, statuses: toggleStatus(filters.statuses, status) })}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                  selected ? "border-primary bg-primary-soft text-ink" : "border-line bg-white text-muted hover:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: ORDER_STATUS_MARKER_COLORS[status] }}
                />
                {ORDER_STATUS_LABELS[status]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FilterField label="Mostrar">
          {(id) => (
            <select
              id={id}
              value={filters.scope}
              onChange={(e) => onChange({ ...filters, scope: e.target.value as MapScope })}
              className={CONTROL_CLASS}
            >
              {SCOPES.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.label}
                </option>
              ))}
            </select>
          )}
        </FilterField>

        <FilterField label="Forma de pago">
          {(id) => (
            <select
              id={id}
              value={filters.paymentMethod}
              onChange={(e) => onChange({ ...filters, paymentMethod: e.target.value as PaymentMethod | "" })}
              className={CONTROL_CLASS}
            >
              <option value="">Todas</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_LABELS[method]}
                </option>
              ))}
            </select>
          )}
        </FilterField>

        <FilterField label="Zona">
          {(id) => (
            <select
              id={id}
              value={filters.zone}
              disabled={zones.length === 0 && !filters.zone}
              onChange={(e) => onChange({ ...filters, zone: e.target.value })}
              className={CONTROL_CLASS}
            >
              <option value="">Todas</option>
              {/* A chosen zone stays selectable after its last order leaves the board. */}
              {[...new Set([...zones, ...(filters.zone ? [filters.zone] : [])])].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          )}
        </FilterField>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
