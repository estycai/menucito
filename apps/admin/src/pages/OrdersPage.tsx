import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Notice } from "@/components/AuthLayout";
import { ActiveOrdersBoard } from "@/components/orders/ActiveOrdersBoard";
import { HistoryOrdersTable } from "@/components/orders/HistoryOrdersTable";
import { OrderDetailDialog } from "@/components/orders/OrderDetailDialog";
import { OrderFiltersBar } from "@/components/orders/OrderFiltersBar";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_ORDERS_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  useOrders,
  useOrdersHistory,
  type OrderFilters,
} from "@/lib/orders";
import { publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useNewOrderAnnouncer } from "@/lib/use-new-order-announcer";
import { useOrdersExport } from "@/lib/use-orders-export";
import { cn } from "@/lib/utils";

export type OrdersTab = "active" | "history";

export function OrdersPage() {
  useDocumentTitle("Pedidos");
  const { data: restaurant } = useMyRestaurant();
  const [tab, setTab] = useState<OrdersTab>("active");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // History filters live in the URL so they survive a reload and can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const historyFilters = filtersFromSearchParams(searchParams);

  const activeQuery = useOrders(ACTIVE_ORDERS_FILTERS);
  const historyQuery = useOrdersHistory(historyFilters);
  const announcement = useNewOrderAnnouncer(activeQuery.data?.orders);
  const csvExport = useOrdersExport(historyFilters);

  const activeOrders = activeQuery.data?.orders;
  const historyOrders = historyQuery.data?.pages.flatMap((page) => page.orders);

  // Only a successful, unfiltered, empty answer of both lists means "never received an order";
  // a failed load shows its error instead.
  const hasNoOrdersEver =
    activeOrders?.length === 0 &&
    historyOrders?.length === 0 &&
    !activeQuery.isError &&
    !historyQuery.isError &&
    Object.keys(historyFilters).length === 0;

  function handleFilterChange(updater: (prev: OrderFilters) => OrderFilters) {
    setSearchParams(filtersToSearchParams(updater(historyFilters)));
  }

  function handleClearFilters() {
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Pedidos</h1>

        <div className="flex items-center gap-2">
          {tab === "history" && (
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
            disabled={activeQuery.isRefetching || historyQuery.isRefetching}
            onClick={() => {
              if (tab === "active") activeQuery.refetch();
              else historyQuery.refetch();
            }}
            className="min-h-11 px-4 text-sm font-bold"
          >
            Actualizar
          </Button>
        </div>
      </div>

      {csvExport.error && <Notice tone="error">{csvExport.error}</Notice>}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

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
            <TabButton selected={tab === "history"} onSelect={() => setTab("history")}>
              Historial
            </TabButton>
          </div>

          {tab === "active" && (
            <ActiveOrdersBoard
              orders={activeOrders}
              isLoading={activeQuery.isLoading}
              isError={activeQuery.isError}
              isRefetching={activeQuery.isRefetching}
              onRefresh={() => void activeQuery.refetch()}
              onSelectOrder={setSelectedOrderId}
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
