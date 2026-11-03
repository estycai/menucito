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
  /** `undefined` until the first successful load. */
  orders: OrderSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  onRefresh: () => void;
  onSelectOrder: (id: string) => void;
}

/** "Activos" tab: the board of active orders, moved forward by drag and drop (mouse, touch or keyboard). */
export function ActiveOrdersBoard({
  orders,
  isLoading,
  isError,
  isRefetching,
  onRefresh,
  onSelectOrder,
}: ActiveOrdersBoardProps) {
  const statusMutation = useChangeOrderStatus();
  const [boardError, setBoardError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

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

  const staleNotice = isError && (
    <QueryError compact message={ORDERS_UI_MESSAGES.listRefreshFailed} onRetry={onRefresh} retrying={isRefetching} />
  );

  if (orders.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {staleNotice}
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-muted">
          No tenés pedidos activos
        </div>
      </div>
    );
  }

  const findOrder = (id: UniqueIdentifier) => orders.find((o) => o.id === id);
  const activeOrder = activeId === null ? undefined : findOrder(activeId);
  const validTargets = activeOrder ? dropTargetsFor(activeOrder.status) : [];

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
          announcements: boardAnnouncements(findOrder),
          screenReaderInstructions: BOARD_SCREEN_READER_INSTRUCTIONS,
        }}
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
              onSelectOrder={handleSelectOrder}
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
