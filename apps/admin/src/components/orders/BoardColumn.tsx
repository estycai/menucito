import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardColumnConfig } from "@/lib/board-dnd";
import type { OrderSummary } from "@menucito/shared";
import { OrderCardContent, orderCardClass } from "@/components/orders/OrderCard";
import { cn } from "@/lib/utils";

export type ColumnDragState = "idle" | "valid" | "invalid";

/**
 * A column of the board, highlighted while a card is dragged. Cards of a final column can still be
 * opened but not dragged: they have nowhere to go.
 */
export function BoardColumn({
  column: { status, label, isFinal = false, emptyMessage },
  orders,
  canMove = true,
  dragState,
  savingIds,
  onSelectOrder,
  footer,
}: {
  column: BoardColumnConfig;
  /** Without `orders.status` every card is a plain button, like the ones of the final column. */
  canMove?: boolean;
  orders: OrderSummary[];
  dragState: ColumnDragState;
  savingIds: Array<string | undefined>;
  onSelectOrder: (id: string) => void;
  footer?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

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
        <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-bold">{orders.length}</span>
      </div>

      {orders.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          {emptyMessage}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) =>
            isFinal || !canMove ? (
              <button
                key={order.id}
                type="button"
                onClick={() => onSelectOrder(order.id)}
                className={orderCardClass(order.notificationAlert)}
              >
                <OrderCardContent order={order} />
              </button>
            ) : (
              <DraggableOrderCard
                key={order.id}
                order={order}
                isSaving={savingIds.includes(order.id)}
                onClick={() => onSelectOrder(order.id)}
              />
            ),
          )}
        </div>
      )}

      {footer}
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
        orderCardClass(order.notificationAlert),
        "touch-manipulation",
        isSaving ? "cursor-progress opacity-70" : "cursor-grab",
        isDragging && "opacity-40",
      )}
    >
      <OrderCardContent order={order} />
    </button>
  );
}
