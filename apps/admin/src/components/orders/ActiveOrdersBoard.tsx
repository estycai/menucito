import { useRef, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import type { OrderSummary } from "@menucito/shared";
import { Notice } from "@/components/AuthLayout";
import { QueryError } from "@/components/QueryError";
import { BoardColumn } from "@/components/orders/BoardColumn";
import { CourierPickerDialog } from "@/components/orders/CourierPickerDialog";
import { OrderCardContent } from "@/components/orders/OrderCard";
import {
  BOARD_COLUMNS,
  BOARD_KEYBOARD_CODES,
  BOARD_SCREEN_READER_INSTRUCTIONS,
  KEYBOARD_DROP_CLICK_GUARD_MS,
  MousePointerSensor,
  boardAnnouncements,
  boardCollisionDetection,
  columnKeyboardCoordinates,
  isClickGuarded,
} from "@/lib/board-dnd";
import {
  ORDER_STATUS_MUTATION_KEY,
  dropTargetsFor,
  isInvalidTransitionError,
  isValidDrop,
  useChangeOrderStatus,
} from "@/lib/orders";
import { ORDERS_UI_MESSAGES } from "@/lib/orders-messages";

interface ActiveOrdersBoardProps {
  /** `orders.status`: without it the cards open the detail but cannot be dragged. */
  canMove?: boolean;
  /** `orders.assign`: "Enviados" is reachable by assigning a courier (change 13, decision 5). */
  canAssign?: boolean;
  /** `undefined` until the first successful load. */
  orders: OrderSummary[] | undefined;
  /** Orders delivered today, for the "Entregados" column; `undefined` until they load. */
  deliveredOrders: OrderSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The delivered list failed: the board still works, with a notice. */
  deliveredError: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
  onSelectOrder: (id: string) => void;
  onShowDeliveredHistory: () => void;
}

/** "Activos" tab: the board of active orders, moved forward by drag and drop (mouse, touch or keyboard). */
export function ActiveOrdersBoard({
  canMove = true,
  canAssign = false,
  orders,
  deliveredOrders = [],
  isLoading,
  isError,
  deliveredError,
  isRefetching,
  onRefresh,
  onSelectOrder,
  onShowDeliveredHistory,
}: ActiveOrdersBoardProps) {
  const statusMutation = useChangeOrderStatus();
  const [boardError, setBoardError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  /** Ready order waiting for a courier: the picker is open for it (change 13 scenario 39). */
  const [assignOrderId, setAssignOrderId] = useState<string | null>(null);

  // Orders with a status change in flight (from the board or the detail dialog) cannot be dragged.
  const savingIds = useMutationState({
    filters: { mutationKey: ORDER_STATUS_MUTATION_KEY, status: "pending" },
    select: (mutation) => (mutation.state.variables as { id: string } | undefined)?.id,
  });

  // A keyboard drag starts and ends on a Space keydown, and the keyup that follows would "click"
  // the card and open the detail (see `isClickGuarded`). Pointer drags already swallow their click
  // inside dnd-kit.
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

  if (!orders) {
    return isError ? (
      <QueryError message={ORDERS_UI_MESSAGES.listLoadFailed} onRetry={onRefresh} retrying={isRefetching} />
    ) : null;
  }

  const staleNotice = (isError || deliveredError) && (
    <QueryError compact message={ORDERS_UI_MESSAGES.listRefreshFailed} onRetry={onRefresh} retrying={isRefetching} />
  );

  if (orders.length === 0 && deliveredOrders.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {staleNotice}
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
          No tenés pedidos activos
        </div>
      </div>
    );
  }

  // Only active orders are draggable, so only they are looked up by the drag handlers.
  const findOrder = (id: UniqueIdentifier) => orders.find((o) => o.id === id);
  const activeOrder = activeId === null ? undefined : findOrder(activeId);
  const validTargets = activeOrder
    ? dropTargetsFor(activeOrder.status, activeOrder.fulfillment, { canChangeStatus: canMove, canAssign })
    : [];
  const assignOrder = assignOrderId === null ? undefined : findOrder(assignOrderId);

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
    if (!order || !over || !isValidDrop(order.status, order.fulfillment, over.id, { canChangeStatus: canMove, canAssign })) return;

    // "Enviados" is only reached by assigning a courier: the drop opens the picker.
    if (over.id === "sent") {
      setBoardError(null);
      setAssignOrderId(order.id);
      return;
    }

    setBoardError(null);
    try {
      await statusMutation.mutateAsync({ id: order.id, status: over.id });
    } catch (err: unknown) {
      if (isInvalidTransitionError(err)) {
        onRefresh();
        setBoardError(ORDERS_UI_MESSAGES.orderChanged);
      } else {
        setBoardError(ORDERS_UI_MESSAGES.updateFailed);
      }
    }
  }

  function handleSelectOrder(id: string) {
    if (isClickGuarded(keyboardDragRef.current, ignoreClicksUntilRef.current, performance.now())) return;
    onSelectOrder(id);
  }

  return (
    <div className="flex flex-col gap-4">
      {staleNotice}
      <div aria-live="polite">{boardError && <Notice tone="error">{boardError}</Notice>}</div>

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        accessibility={{
          announcements: boardAnnouncements(findOrder, { canChangeStatus: canMove, canAssign }),
          screenReaderInstructions: BOARD_SCREEN_READER_INSTRUCTIONS,
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* From lg the five columns share a row; when they do not fit, the board scrolls, not the page. */}
        <div className="lg:-mx-1 lg:overflow-x-auto lg:px-1 lg:pb-2">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[repeat(5,minmax(11rem,1fr))] lg:gap-3">
            {BOARD_COLUMNS.map((column) => (
              <BoardColumn
                key={column.status}
                column={column}
                orders={column.isFinal ? deliveredOrders : orders.filter((o) => o.status === column.status)}
                canMove={canMove || canAssign}
                dragState={!activeOrder ? "idle" : validTargets.includes(column.status) ? "valid" : "invalid"}
                savingIds={savingIds}
                onSelectOrder={handleSelectOrder}
                footer={column.isFinal && <HistoryLink onClick={onShowDeliveredHistory} />}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeOrder ? (
            <div className="flex cursor-grabbing flex-col gap-2 rounded-xl border border-primary bg-white p-4 text-left shadow-xl">
              <OrderCardContent order={activeOrder} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {assignOrder && (
        <CourierPickerDialog
          order={{
            id: assignOrder.id,
            number: assignOrder.number,
            customerName: assignOrder.customerName,
            totalCents: assignOrder.totalCents,
          }}
          status={assignOrder.status}
          currentCourierId={assignOrder.courier?.memberId ?? null}
          onClose={() => setAssignOrderId(null)}
          onAssigned={() => setAssignOrderId(null)}
        />
      )}
    </div>
  );
}

/** Footer of the final column: today's delivered orders in "Historial", beyond the ones shown here. */
function HistoryLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 cursor-pointer self-start rounded-lg px-1 text-sm font-bold text-link hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      Ver todos en el historial
    </button>
  );
}
