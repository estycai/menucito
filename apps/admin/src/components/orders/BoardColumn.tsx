import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { OrderSummary } from "@menucito/shared";
import { ORDER_CARD_CLASS, OrderCardContent } from "@/components/orders/OrderCard";
import type { BoardDropStatus } from "@/lib/orders";
import { cn } from "@/lib/utils";

export type ColumnDragState = "idle" | "valid" | "invalid";

/** A column of the board (or the "Entregados" drop zone), highlighted while a card is dragged. */
export function BoardColumn({
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
  dragState: ColumnDragState;
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
