import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSearchParams } from "react-router";
import { useMutationState } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  describeOrderOptions,
  formatArs,
  formatLocalDateTime,
  formatLocalTime,
  nextStatus,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
} from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  ACTIVE_ORDERS_FILTERS,
  ORDER_STATUS_MUTATION_KEY,
  adjacentColumn,
  downloadOrdersCsv,
  dropTargetsFor,
  filtersFromSearchParams,
  filtersToSearchParams,
  isInvalidTransitionError,
  isValidDrop,
  useChangeOrderPayment,
  useChangeOrderStatus,
  useOrder,
  useOrders,
  useOrdersHistory,
  type BoardDropStatus,
  type DatePreset,
  type OrderFilters,
} from "@/lib/orders";
import { publicMenuUrl, useMyRestaurant } from "@/lib/restaurant";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";

export function OrdersPage() {
  useDocumentTitle("Pedidos");
  const { data: restaurant } = useMyRestaurant();
  const [tab, setTab] = useState<"active" | "history">("active");

  const [searchParams, setSearchParams] = useSearchParams();
  const historyFilters = filtersFromSearchParams(searchParams);

  // Detail dialog state
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Active orders query for tab "active"
  const activeQuery = useOrders(ACTIVE_ORDERS_FILTERS);

  // History query for tab "history"
  const historyQuery = useOrdersHistory(historyFilters);

  // Track new orders announcement
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // `null` until the first load: what is already there is not announced, but the very first
  // order arriving on an empty board is (scenario 41).
  const prevActiveIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!activeQuery.data?.orders) return;
    const currentIds = new Set(activeQuery.data.orders.map((o) => o.id));
    if (prevActiveIdsRef.current !== null) {
      let newCount = 0;
      for (const id of currentIds) {
        if (!prevActiveIdsRef.current.has(id)) newCount++;
      }
      if (newCount > 0) {
        setAnnouncement(
          newCount === 1 ? "Llegó 1 pedido nuevo" : `Llegaron ${newCount} pedidos nuevos`,
        );
      }
    }
    prevActiveIdsRef.current = currentIds;
  }, [activeQuery.data?.orders]);

  // Export CSV state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      await downloadOrdersCsv(historyFilters);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EXPORT_TOO_LARGE") {
        setExportError("Hay demasiados pedidos para exportar. Acotá las fechas.");
      } else {
        setExportError("No pudimos exportar los pedidos. Probá de nuevo.");
      }
    } finally {
      setIsExporting(false);
    }
  }

  function handleFilterChange(updater: (prev: OrderFilters) => OrderFilters) {
    const updated = updater(historyFilters);
    setSearchParams(filtersToSearchParams(updated));
  }

  function handleClearFilters() {
    setSearchParams(new URLSearchParams());
  }

  const activeOrders = activeQuery.data?.orders ?? [];
  const historyOrders = historyQuery.data?.pages.flatMap((page) => page.orders) ?? [];

  // Check if store never received orders
  const hasNoOrdersEver =
    !activeQuery.isLoading &&
    !historyQuery.isLoading &&
    activeOrders.length === 0 &&
    historyOrders.length === 0 &&
    Object.keys(historyFilters).length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-display text-[28px] font-extrabold sm:text-[32px]">Pedidos</h1>

        <div className="flex items-center gap-2">
          {tab === "history" && (
            <Button
              type="button"
              variant="outline"
              disabled={isExporting || historyOrders.length === 0}
              onClick={handleExport}
              className="min-h-11 px-4 text-sm font-bold"
            >
              {isExporting ? "Exportando…" : "Exportar CSV"}
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

      {exportError && <Notice tone="error">{exportError}</Notice>}

      {/* Screen reader live announcement */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {hasNoOrdersEver ? (
        <section className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
          <p className="m-0 text-base text-ink">
            Todavía no recibiste pedidos. Compartí tu link para empezar.
          </p>
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
          {/* Tabs */}
          <div className="flex border-b border-line" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "active"}
              onClick={() => setTab("active")}
              className={cn(
                "min-h-11 cursor-pointer border-b-2 px-5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                tab === "active" ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              Activos {activeOrders.length > 0 && `(${activeOrders.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "history"}
              onClick={() => setTab("history")}
              className={cn(
                "min-h-11 cursor-pointer border-b-2 px-5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                tab === "history" ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              Historial
            </button>
          </div>

          {/* Active Tab */}
          {tab === "active" && (
            <ActiveOrdersView
              orders={activeOrders}
              isLoading={activeQuery.isLoading}
              onSelectOrder={setSelectedOrderId}
              onRefresh={() => void activeQuery.refetch()}
            />
          )}

          {/* History Tab */}
          {tab === "history" && (
            <HistoryOrdersView
              orders={historyOrders}
              isLoading={historyQuery.isLoading}
              filters={historyFilters}
              hasMore={historyQuery.hasNextPage}
              isLoadingMore={historyQuery.isFetchingNextPage}
              onLoadMore={() => void historyQuery.fetchNextPage()}
              onFilterChange={handleFilterChange}
              onClearFilters={handleClearFilters}
              onSelectOrder={setSelectedOrderId}
            />
          )}
        </>
      )}

      {/* Order Detail Modal */}
      {selectedOrderId && (
        <OrderDetailDialog
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Active Orders (Columns)
// ----------------------------------------------------------------------------

function ActiveOrdersView({
  orders,
  isLoading,
  onSelectOrder,
  onRefresh,
}: {
  orders: OrderSummary[];
  isLoading: boolean;
  onSelectOrder: (id: string) => void;
  onRefresh: () => void;
}) {
  const statusMutation = useChangeOrderStatus();
  const [boardError, setBoardError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  // Orders with a status change in flight (from the board or the detail dialog) cannot be dragged.
  const savingIds = useMutationState({
    filters: { mutationKey: ORDER_STATUS_MUTATION_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as { id: string } | undefined)?.id,
  });

  // A keyboard drag starts and ends on a Space keydown, and the keyup that follows would "click"
  // the card and open the detail. Clicks are ignored while a keyboard drag is in progress and for a
  // short moment after it ends; a time window (not "until keyup") can never get stuck if the keyup
  // is lost. Pointer drags already swallow their click inside dnd-kit.
  const keyboardDragRef = useRef(false);
  const ignoreClicksUntilRef = useRef(0);
  function endKeyboardDrag() {
    keyboardDragRef.current = false;
    ignoreClicksUntilRef.current = performance.now() + KEYBOARD_DROP_CLICK_GUARD_MS;
  }

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: BOARD_KEYBOARD_CODES,
      coordinateGetter: columnKeyboardCoordinates,
    }),
  );

  if (isLoading) {
    return <div className="p-8 text-center text-muted">Cargando pedidos…</div>;
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
        No tenés pedidos activos
      </div>
    );
  }

  const findOrder = (id: UniqueIdentifier) => orders.find((o) => o.id === id);
  const numberOf = (id: UniqueIdentifier) => `#${findOrder(id)?.number ?? ""}`;
  const activeOrder = activeId === null ? undefined : findOrder(activeId);
  const validTargets = activeOrder ? dropTargetsFor(activeOrder.status) : [];

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste el pedido ${numberOf(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `Pedido ${numberOf(active.id)} fuera de las columnas.`;
      const order = findOrder(active.id);
      const label = ORDER_STATUS_LABELS[over.id as BoardDropStatus];
      return order && isValidDrop(order.status, over.id)
        ? `Pedido ${numberOf(active.id)} sobre ${label}.`
        : `Pedido ${numberOf(active.id)} sobre ${label}. No se puede mover ahí.`;
    },
    onDragEnd: ({ active, over }) => {
      const order = findOrder(active.id);
      return order && over && isValidDrop(order.status, over.id)
        ? `Soltaste el pedido ${numberOf(active.id)} en ${ORDER_STATUS_LABELS[over.id]}.`
        : `Soltaste el pedido ${numberOf(active.id)}. No cambió de estado.`;
    },
    onDragCancel: () => "Cancelaste el arrastre.",
  };

  function handleDragStart({ active, activatorEvent }: DragStartEvent) {
    setActiveId(active.id);
    if (activatorEvent instanceof KeyboardEvent) keyboardDragRef.current = true;
  }

  function handleDragCancel({ activatorEvent }: DragCancelEvent) {
    setActiveId(null);
    if (activatorEvent instanceof KeyboardEvent) endKeyboardDrag();
  }

  async function handleDragEnd({ active, over, activatorEvent }: DragEndEvent) {
    setActiveId(null);
    if (activatorEvent instanceof KeyboardEvent) endKeyboardDrag();

    const order = findOrder(active.id);
    // Same column, a column behind or outside the board: nothing changes.
    if (!order || !over || !isValidDrop(order.status, over.id)) return;

    setBoardError(null);
    try {
      await statusMutation.mutateAsync({ id: order.id, status: over.id });
    } catch (err: unknown) {
      if (isInvalidTransitionError(err)) {
        onRefresh();
        setBoardError("El pedido cambió. Lo actualizamos.");
      } else {
        setBoardError("No pudimos actualizar el pedido. Probá de nuevo.");
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">{boardError && <Notice tone="error">{boardError}</Notice>}</div>

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        accessibility={{ announcements, screenReaderInstructions: BOARD_SCREEN_READER_INSTRUCTIONS }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {BOARD_COLUMNS.map(({ status, label }) => (
            <BoardColumn
              key={status}
              status={status}
              label={label}
              orders={orders.filter((o) => o.status === status)}
              dragState={!activeOrder ? "idle" : validTargets.includes(status) ? "valid" : "invalid"}
              savingIds={savingIds}
              onSelectOrder={(id) => {
                if (keyboardDragRef.current || performance.now() < ignoreClicksUntilRef.current) return;
                onSelectOrder(id);
              }}
            />
          ))}
        </div>

        <DragOverlay>
          {activeOrder ? (
            <div className="flex cursor-grabbing flex-col gap-2 rounded-xl border border-primary bg-white p-4 text-left shadow-xl">
              <OrderCardContent order={activeOrder} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// One hue per stage of the flow. Amber and green stay reserved for the payment status
// (Pendiente / Pagado) so the two badges of a row never read as the same thing. Dark text on
// a 100 tint keeps every pair above AA contrast.
const ORDER_STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  new: "bg-[#DBEAFE] text-[#1E40AF]",
  preparing: "bg-[#EDE9FE] text-[#5B21B6]",
  ready: "bg-[#CCFBF1] text-[#115E59]",
  delivered: "bg-line text-ink",
  cancelled: "bg-[#FEE2E2] text-danger",
};

// "Entregados" is only a drop zone: delivered orders leave the board (they live in "Historial").
const BOARD_COLUMNS: Array<{ status: BoardDropStatus; label: string }> = [
  { status: "new", label: "Nuevos" },
  { status: "preparing", label: "En preparación" },
  { status: "ready", label: "Listos" },
  { status: "delivered", label: "Entregados" },
];

// Long enough to cover the keyup "click" that follows a keyboard drop, short enough to go unnoticed.
const KEYBOARD_DROP_CLICK_GUARD_MS = 400;

// Space picks a card up and drops it; Enter keeps opening the detail (and also drops while dragging).
const BOARD_KEYBOARD_CODES: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
};

const BOARD_SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Para mover el pedido, presioná Espacio. Con las flechas elegís la columna, con Espacio lo soltás y con Escape cancelás. Con Enter abrís el detalle.",
};

/** Mouse and pen only: touch goes through the TouchSensor and its press delay, so scrolling still works. */
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch") return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

/** Pointer position first (it works with the stacked columns on phones), card overlap for keyboard drags. */
const boardCollisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

const ARROW_STEPS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Arrow keys jump the dragged card to the previous or next column instead of moving it by pixels. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const step = ARROW_STEPS[event.code];
  if (!step) return undefined;
  event.preventDefault();

  const { active, over, droppableRects, collisionRect } = context;
  const target = adjacentColumn(over?.id ?? active?.data.current?.status, step);
  const rect = target ? droppableRects.get(target) : undefined;  if (!rect || !collisionRect) return undefined;
  return {
    x: rect.left + Math.max(0, (rect.width - collisionRect.width) / 2),
    y: rect.top + Math.max(0, Math.min(56, (rect.height - collisionRect.height) / 2)),
  };
};

function BoardColumn({
  status,
  label,
  orders,
  dragState,
  savingIds,
  onSelectOrder,
}: {
  status: BoardDropStatus;
  label: string;
  orders: OrderSummary[];
  dragState: "idle" | "valid" | "invalid";
  savingIds: Array<string | undefined>;
  onSelectOrder: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isDropZone = status === "delivered";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-bg/50 p-4 transition",
        dragState === "valid" && "border-dashed border-primary bg-primary/5",
        dragState === "valid" && isOver && "border-solid ring-2 ring-primary",
        dragState === "invalid" && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base font-extrabold">{label}</h2>
        {!isDropZone && (
          <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-bold">{orders.length}</span>
        )}
      </div>

      {isDropZone ? (
        <p className="m-0 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Soltá un pedido acá para marcarlo como entregado.
        </p>
      ) : orders.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Sin pedidos
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <DraggableOrderCard
              key={order.id}
              order={order}
              isSaving={savingIds.includes(order.id)}
              onClick={() => onSelectOrder(order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableOrderCard({
  order,
  isSaving,
  onClick,
}: {
  order: OrderSummary;
  isSaving: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: order.id,
    data: { status: order.status },
    disabled: isSaving,
    attributes: { roleDescription: "pedido arrastrable" },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      // Only dragging pauses while saving: the card still opens the detail.
      aria-disabled={undefined}
      aria-busy={isSaving || undefined}
      onClick={onClick}
      className={cn(
        ORDER_CARD_CLASS,
        "touch-manipulation",
        isSaving ? "cursor-progress opacity-70" : "cursor-grab",
        isDragging && "opacity-40",
      )}
    >
      <OrderCardContent order={order} />
    </button>
  );
}

const ORDER_CARD_CLASS =
  "flex min-h-[44px] cursor-pointer flex-col gap-2 rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary";

function OrderCard({ order, onClick }: { order: OrderSummary; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={ORDER_CARD_CLASS}>
      <OrderCardContent order={order} showStatus />
    </button>
  );
}

/** `showStatus` is for lists that mix statuses (history); on the board the column already says it. */
function OrderCardContent({ order, showStatus = false }: { order: OrderSummary; showStatus?: boolean }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-extrabold text-ink">#{order.number}</span>
        <span className="flex items-center gap-2">
          {showStatus && (
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", ORDER_STATUS_BADGE_CLASS[order.status])}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          )}
          <span className="text-xs text-muted">{formatLocalTime(order.createdAt)}</span>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-ink">{order.customerName}</span>
        <span className="rounded-md bg-bg px-2 py-0.5 text-xs font-bold text-muted">
          {FULFILLMENT_LABELS[order.fulfillment]}
        </span>
      </div>

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

// ----------------------------------------------------------------------------
// History Orders (Table & Filters)
// ----------------------------------------------------------------------------

function HistoryOrdersView({
  orders,
  isLoading,
  filters,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onFilterChange,
  onClearFilters,
  onSelectOrder,
}: {
  orders: OrderSummary[];
  isLoading: boolean;
  filters: OrderFilters;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onFilterChange: (updater: (prev: OrderFilters) => OrderFilters) => void;
  onClearFilters: () => void;
  onSelectOrder: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Filters Toolbar */}
      <OrderFiltersBar filters={filters} onFilterChange={onFilterChange} />

      {isLoading ? (
        <div className="p-8 text-center text-muted">Cargando pedidos…</div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
          <p className="m-0 text-base text-ink">No hay pedidos con esos filtros.</p>
          <Button type="button" variant="outline" onClick={onClearFilters} className="min-h-11 px-4 text-sm font-bold">
            Limpiar filtros
          </Button>
        </div>
      ) : (
        <>
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
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", ORDER_STATUS_BADGE_CLASS[order.status])}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs font-bold",
                          order.paymentStatus === "paid"
                            ? "bg-[#DCFCE7] text-success"
                            : "bg-[#FEF3C7] text-warning",
                        )}
                      >
                        {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                      </span>
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

          {/* Pagination */}
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
      )}
    </div>
  );
}

function OrderFiltersBar({
  filters,
  onFilterChange,
}: {
  filters: OrderFilters;
  onFilterChange: (updater: (prev: OrderFilters) => OrderFilters) => void;
}) {
  const presets: Array<{ id: DatePreset; label: string }> = [
    { id: "", label: "Todas las fechas" },
    { id: "today", label: "Hoy" },
    { id: "7d", label: "Últimos 7 días" },
    { id: "30d", label: "Últimos 30 días" },
    { id: "custom", label: "Personalizado" },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
      {/* Presets and Filters Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Date Preset */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted">Fecha</label>
          <select
            value={filters.preset ?? ""}
            onChange={(e) => {
              const val = e.target.value as DatePreset;
              onFilterChange((prev) => ({
                ...prev,
                preset: val,
                from: val === "custom" ? prev.from : undefined,
                to: val === "custom" ? prev.to : undefined,
              }));
            }}
            className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted">Estado</label>
          <select
            value={filters.status ?? ""}
            onChange={(e) =>
              onFilterChange((prev) => ({ ...prev, status: e.target.value || undefined }))
            }
            className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todos los estados</option>
            <option value="new">Nuevo</option>
            <option value="preparing">En preparación</option>
            <option value="ready">Listo</option>
            <option value="delivered">Entregado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>

        {/* Fulfillment */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted">Modalidad</label>
          <select
            value={filters.fulfillment ?? ""}
            onChange={(e) =>
              onFilterChange((prev) => ({ ...prev, fulfillment: e.target.value || undefined }))
            }
            className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todas</option>
            <option value="delivery">Envío</option>
            <option value="takeaway">Retiro</option>
          </select>
        </div>

        {/* Payment Method */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted">Forma de pago</label>
          <select
            value={filters.paymentMethod ?? ""}
            onChange={(e) =>
              onFilterChange((prev) => ({ ...prev, paymentMethod: e.target.value || undefined }))
            }
            className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todas</option>
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
          </select>
        </div>

        {/* Payment Status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-muted">Estado de pago</label>
          <select
            value={filters.paymentStatus ?? ""}
            onChange={(e) =>
              onFilterChange((prev) => ({ ...prev, paymentStatus: e.target.value || undefined }))
            }
            className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
          </select>
        </div>
      </div>

      {/* Custom Date Inputs */}
      {filters.preset === "custom" && (
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-muted">Desde</label>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) =>
                onFilterChange((prev) => ({ ...prev, from: e.target.value || undefined }))
              }
              className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-muted">Hasta</label>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) =>
                onFilterChange((prev) => ({ ...prev, to: e.target.value || undefined }))
              }
              className="box-border min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Order Detail Modal Dialog
// ----------------------------------------------------------------------------

function OrderDetailDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const { data: order, isLoading, refetch } = useOrder(orderId);
  const statusMutation = useChangeOrderStatus();
  const paymentMutation = useChangeOrderPayment();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  async function handleStatusChange(targetStatus: OrderStatus) {
    if (!order) return;
    setErrorMsg(null);
    try {
      await statusMutation.mutateAsync({ id: order.id, status: targetStatus });
      setShowCancelConfirm(false);
    } catch (err: unknown) {
      if (isInvalidTransitionError(err)) {
        refetch();
        setErrorMsg("El pedido cambió. Lo actualizamos.");
      } else {
        setErrorMsg("No pudimos actualizar el pedido. Probá de nuevo.");
      }
    }
  }

  async function handlePaymentToggle() {
    if (!order) return;
    setErrorMsg(null);
    const nextPayment: PaymentStatus = order.paymentStatus === "pending" ? "paid" : "pending";
    try {
      await paymentMutation.mutateAsync({ id: order.id, paymentStatus: nextPayment });
    } catch {
      setErrorMsg("No pudimos actualizar el pedido. Probá de nuevo.");
    }
  }

  const isPendingAction = statusMutation.isPending || paymentMutation.isPending;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto h-fit max-h-[90vh] w-full max-w-[550px] overflow-y-auto rounded-2xl border border-line bg-white p-5 text-ink shadow-2xl backdrop:bg-black/40 open:block sm:p-6"
    >
      <div className="flex flex-col gap-5">
        {/* Dialog Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div>
            <h2 id={titleId} className="m-0 font-display text-xl font-extrabold">
              {order ? `Pedido #${order.number}` : "Cargando…"}
            </h2>
            {order && (
              <span className="text-xs text-muted">{formatLocalDateTime(order.createdAt)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            ✕
          </button>
        </div>

        {errorMsg && <Notice tone="error">{errorMsg}</Notice>}

        {isLoading || !order ? (
          <div className="py-8 text-center text-muted">Cargando detalles del pedido…</div>
        ) : (
          <>
            {/* Statuses Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-md px-2.5 py-1 text-xs font-bold", ORDER_STATUS_BADGE_CLASS[order.status])}>
                {ORDER_STATUS_LABELS[order.status]}
              </span>
              <span
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-bold",
                  order.paymentStatus === "paid"
                    ? "bg-[#DCFCE7] text-success"
                    : "bg-[#FEF3C7] text-warning",
                )}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </span>
              <span className="rounded-md bg-bg px-2.5 py-1 text-xs font-bold text-muted">
                {FULFILLMENT_LABELS[order.fulfillment]} · {PAYMENT_LABELS[order.paymentMethod]}
              </span>
            </div>

            {/* Customer & Address */}
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-bg/50 p-3.5 text-sm">
              <span className="font-bold text-ink">{order.customerName}</span>
              <a
                href={`https://wa.me/${order.customerPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-link hover:underline"
              >
                +{order.customerPhone} (WhatsApp)
              </a>
              {order.fulfillment === "delivery" && order.deliveryAddress && (
                <span className="text-muted">Entrega: {order.deliveryAddress}</span>
              )}
            </div>

            {/* Items */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-muted">Ítems</span>
              <div className="divide-y divide-line rounded-xl border border-line bg-white">
                {order.items.map((item) => {
                  const options = describeOrderOptions(item.options);
                  return (
                    <div key={item.id} className="flex flex-col p-3 text-sm">
                      <div className="flex items-center justify-between font-semibold">
                        <span>
                          {item.quantity}x {item.name}
                        </span>
                        <span>{formatArs(item.unitPriceCents * item.quantity)}</span>
                      </div>
                      {options.length > 0 && (
                        <ul className="m-0 list-none p-0 text-xs text-muted">
                          {options.map((option) => (
                            <li key={option}>{option}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Totals */}
            <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-muted">
                <span>Subtotal</span>
                <span>{formatArs(order.subtotalCents)}</span>
              </div>
              {order.fulfillment === "delivery" && (
                <div className="flex justify-between text-muted">
                  <span>Envío</span>
                  <span>{order.shippingCents > 0 ? formatArs(order.shippingCents) : "Gratis"}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-ink pt-1">
                <span>Total</span>
                <span>{formatArs(order.totalCents)}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {/* Status progression button */}
              {nextStatus(order.status) && !showCancelConfirm && (
                <Button
                  type="button"
                  disabled={isPendingAction}
                  onClick={() => handleStatusChange(nextStatus(order.status)!)}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  Pasar a {ORDER_STATUS_LABELS[nextStatus(order.status)!]}
                </Button>
              )}

              {/* Payment status toggle */}
              {!showCancelConfirm && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPendingAction}
                  onClick={handlePaymentToggle}
                  className="min-h-11 w-full text-sm font-bold"
                >
                  {order.paymentStatus === "pending"
                    ? "Marcar como pagado"
                    : "Marcar como pendiente de pago"}
                </Button>
              )}

              {/* Cancel button & confirmation */}
              {order.status !== "delivered" && order.status !== "cancelled" && (
                showCancelConfirm ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                    <p className="m-0 text-sm font-bold text-danger text-center">
                      ¿Seguro que querés cancelar este pedido?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPendingAction}
                        onClick={() => setShowCancelConfirm(false)}
                        className="min-h-11 flex-1 text-sm font-bold"
                      >
                        Volver
                      </Button>
                      <Button
                        type="button"
                        disabled={isPendingAction}
                        onClick={() => handleStatusChange("cancelled")}
                        className="min-h-11 flex-1 text-sm font-bold bg-danger text-white hover:bg-danger/90"
                      >
                        Sí, cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPendingAction}
                    onClick={() => setShowCancelConfirm(true)}
                    className="min-h-11 w-full text-sm text-danger hover:bg-danger/10"
                  >
                    Cancelar pedido
                  </Button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
