import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Notice } from "@/components/AuthLayout";
import { ActiveOrdersBoard } from "@/components/orders/ActiveOrdersBoard";
import { FulfillmentFilter } from "@/components/orders/FulfillmentFilter";
import { HistoryOrdersTable } from "@/components/orders/HistoryOrdersTable";
import { OrderDetailDialog } from "@/components/orders/OrderDetailDialog";
import { OrderFiltersBar } from "@/components/orders/OrderFiltersBar";
import { OrderSettingsSheet } from "@/components/orders/OrderSettingsSheet";
import { NewOrderDialog } from "@/components/orders/new-order/NewOrderDialog";
import { OrdersListView } from "@/components/orders/OrdersListView";
import { OrdersMapView } from "@/components/orders/OrdersMapView";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_ORDERS_FILTERS,
  DELIVERED_TODAY_FILTERS,
  DELIVERED_TODAY_HISTORY_FILTERS,
  filterByFulfillment,
  filtersFromSearchParams,
  filtersToSearchParams,
  useOrders,
  useOrdersHistory,
  type FulfillmentMode,
  type OrderFilters,
} from "@/lib/orders";
import {
  ORDERS_FULFILLMENT_PARAM,
  ORDERS_INDIVIDUAL_VIEW,
  ORDERS_MAP_VIEW,
  ORDERS_VIEW_PARAM,
  parseFulfillmentMode,
  parseOrdersView,
  type OrdersView,
} from "@/lib/orders-map";
import { useAccess } from "@/lib/access";
import { publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useOrdersExport } from "@/lib/use-orders-export";
import { useOrdersNavigationTarget } from "@/lib/use-orders-navigation-target";
import { cn } from "@/lib/utils";

export type OrdersTab = "active" | "history";

export function OrdersPage() {
  useDocumentTitle("Pedidos");
  const { data: restaurant } = useMyRestaurant();
  // Without these keys the actions are not offered (the API refuses them anyway).
  const { can, canEditOrderSettings, canCreateOrders } = useAccess();
  const canMove = can("orders.status");
  const canAssign = can("orders.assign");
  const canExport = can("orders.export");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  // History filters live in the URL so they survive a reload and can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  // Cajas links to the history of one session with `?tab=historial`.
  const [tab, setTab] = useState<OrdersTab>(() => (searchParams.get("tab") === "historial" ? "history" : "active"));
  const historyFilters = filtersFromSearchParams(searchParams);
  // "Activos" shows the board, the Individual list or the map (`?vista=`); `?modo=` filters by fulfillment.
  const view = parseOrdersView(searchParams.get(ORDERS_VIEW_PARAM));
  const fulfillmentMode = parseFulfillmentMode(searchParams.get(ORDERS_FULFILLMENT_PARAM));
  const showMap = tab === "active" && view === "map";
  const showIndividual = tab === "active" && view === "individual";

  const activeQuery = useOrders(ACTIVE_ORDERS_FILTERS);
  const deliveredQuery = useOrders(DELIVERED_TODAY_FILTERS);
  const historyQuery = useOrdersHistory(historyFilters);
  const csvExport = useOrdersExport(historyFilters);

  // A new-order toast lands here with the board to show and maybe an order to open.
  useOrdersNavigationTarget((target) => {
    setTab("active");
    if (target.openOrderId) setSelectedOrderId(target.openOrderId);
  });

  const activeOrders = activeQuery.data?.orders;
  const historyOrders = historyQuery.data?.pages.flatMap((page) => page.orders);
  const deliveredOrders = deliveredQuery.data?.orders;
  // The filter only affects the board and the Individual view; the map and the history keep their own.
  const filteredActiveOrders = activeOrders ? filterByFulfillment(activeOrders, fulfillmentMode) : undefined;
  const filteredDeliveredOrders = deliveredOrders ? filterByFulfillment(deliveredOrders, fulfillmentMode) : undefined;

  // Only a successful, unfiltered, empty answer of both lists means "never received an order";
  // a failed load shows its error instead.
  const hasNoOrdersEver =
    activeOrders?.length === 0 &&
    historyOrders?.length === 0 &&
    !activeQuery.isError &&
    !historyQuery.isError &&
    Object.keys(historyFilters).length === 0;
  const filterVisible =
    tab === "active" && !showMap && Boolean(restaurant?.delivery && restaurant?.takeaway) && !hasNoOrdersEver;

  function handleFilterChange(updater: (prev: OrderFilters) => OrderFilters) {
    setSearchParams(filtersToSearchParams(updater(historyFilters)));
  }

  function handleClearFilters() {
    setSearchParams(new URLSearchParams());
  }

  /** Both lists of the "Activos" board: active orders and today's delivered ones. */
  function refreshBoard() {
    void activeQuery.refetch();
    void deliveredQuery.refetch();
  }

  function handleViewChange(nextView: OrdersView) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextView === "board") next.delete(ORDERS_VIEW_PARAM);
        else next.set(ORDERS_VIEW_PARAM, nextView === "map" ? ORDERS_MAP_VIEW : ORDERS_INDIVIDUAL_VIEW);
        return next;
      },
      { replace: true },
    );
  }

  function handleFulfillmentChange(mode: FulfillmentMode | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (mode) next.set(ORDERS_FULFILLMENT_PARAM, mode);
        else next.delete(ORDERS_FULFILLMENT_PARAM);
        return next;
      },
      { replace: true },
    );
  }

  function handleShowHistory() {
    handleViewChange("board");
    setTab("history");
  }

  function handleShowDeliveredHistory() {
    setSearchParams(filtersToSearchParams(DELIVERED_TODAY_HISTORY_FILTERS));
    setTab("history");
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Pedidos</h1>

        <div className="flex flex-wrap items-center gap-2">
          {tab === "active" && !hasNoOrdersEver && <ViewToggle view={view} onChange={handleViewChange} />}
          {filterVisible && (
            <FulfillmentFilter
              value={fulfillmentMode}
              total={activeOrders?.length ?? 0}
              onChange={handleFulfillmentChange}
            />
          )}

          {tab === "history" && canExport && (
            <Button
              type="button"
              variant="outline"
              disabled={csvExport.isExporting || !historyOrders?.length}
              onClick={csvExport.exportCsv}
              className="min-h-11 px-4 text-sm font-bold"
            >
              {csvExport.isExporting ? "Exportando…" : "Exportar CSV"}
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={activeQuery.isRefetching || deliveredQuery.isRefetching || historyQuery.isRefetching}
            onClick={() => {
              if (tab === "active") refreshBoard();
              else void historyQuery.refetch();
            }}
            aria-label="Actualizar"
            title="Actualizar"
            className="size-11 min-h-11 p-0"
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={activeQuery.isRefetching || deliveredQuery.isRefetching || historyQuery.isRefetching ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
              <path d="M3 21v-5h5" />
              <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </Button>

          {canCreateOrders && (
            <Button
              type="button"
              onClick={() => setNewOrderOpen(true)}
              className="min-h-11 px-4 text-sm font-bold"
            >
              Nuevo pedido
            </Button>
          )}

          {canEditOrderSettings && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              aria-label="Ajustes de pedidos"
              title="Ajustes de pedidos"
              className="size-11 min-h-11 p-0"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09A1.7 1.7 0 0 0 21 10.14H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
              </svg>
            </Button>
          )}
        </div>
      </div>

      {csvExport.error && <Notice tone="error">{csvExport.error}</Notice>}

      {hasNoOrdersEver ? (
        <section className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
          <p className="m-0 text-base text-ink">Todavía no recibiste pedidos. Compartí tu link para empezar.</p>
          {restaurant && (
            <a
              href={`https://${publicMenuUrl(restaurant.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-link hover:underline"
            >
              Ver menú público
            </a>
          )}
        </section>
      ) : (
        <>
          <div className="flex border-b border-line" role="tablist">
            <TabButton selected={tab === "active"} onSelect={() => setTab("active")}>
              Activos {activeOrders && activeOrders.length > 0 && `(${activeOrders.length})`}
            </TabButton>
            <TabButton selected={tab === "history"} onSelect={handleShowHistory}>
              Historial
            </TabButton>
          </div>

          {showMap && (
            <OrdersMapView
              orders={activeOrders}
              deliveredOrders={deliveredOrders}
              isLoading={activeQuery.isLoading}
              isError={activeQuery.isError}
              deliveredError={deliveredQuery.isError}
              isRefetching={activeQuery.isRefetching || deliveredQuery.isRefetching}
              onRefresh={refreshBoard}
              onSelectOrder={setSelectedOrderId}
            />
          )}

          {showIndividual && (
            <OrdersListView
              orders={filteredActiveOrders ?? []}
              deliveryEnabled={Boolean(restaurant?.delivery)}
              onSelectOrder={setSelectedOrderId}
            />
          )}

          {tab === "active" && !showMap && !showIndividual && (
            <ActiveOrdersBoard
              canMove={canMove}
              canAssign={canAssign}
              orders={filteredActiveOrders}
              deliveredOrders={filteredDeliveredOrders}
              isLoading={activeQuery.isLoading}
              isError={activeQuery.isError}
              deliveredError={deliveredQuery.isError}
              isRefetching={activeQuery.isRefetching || deliveredQuery.isRefetching}
              onRefresh={refreshBoard}
              onSelectOrder={setSelectedOrderId}
              onShowDeliveredHistory={handleShowDeliveredHistory}
            />
          )}

          {tab === "history" && (
            <div className="flex flex-col gap-4">
              <OrderFiltersBar filters={historyFilters} onFilterChange={handleFilterChange} />
              <HistoryOrdersTable
                orders={historyOrders}
                isLoading={historyQuery.isLoading}
                isError={historyQuery.isError}
                isRefetching={historyQuery.isRefetching}
                hasMore={historyQuery.hasNextPage}
                isLoadingMore={historyQuery.isFetchingNextPage}
                // A failed "Cargar más" retries that page; any other failure reloads the list.
                onRetry={() =>
                  void (historyQuery.isFetchNextPageError ? historyQuery.fetchNextPage() : historyQuery.refetch())
                }
                onLoadMore={() => void historyQuery.fetchNextPage()}
                onClearFilters={handleClearFilters}
                onSelectOrder={setSelectedOrderId}
              />
            </div>
          )}
        </>
      )}

      {selectedOrderId && <OrderDetailDialog orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />}
      {settingsOpen && <OrderSettingsSheet onClose={() => setSettingsOpen(false)} />}
      {newOrderOpen && <NewOrderDialog slug={restaurant?.slug ?? null} onClose={() => setNewOrderOpen(false)} />}
    </div>
  );
}

function TabButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "min-h-11 cursor-pointer border-b-2 px-5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        selected ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** "Tablero / Individual / Mapa" switch of the "Activos" tab. */
function ViewToggle({ view, onChange }: { view: OrdersView; onChange: (view: OrdersView) => void }) {
  const option = (value: OrdersView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={cn(
        "min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        view === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Vista de pedidos activos" className="flex rounded-xl bg-tab p-1">
      {option("board", "Tablero")}
      {option("individual", "Individual")}
      {option("map", "Mapa")}
    </div>
  );
}
