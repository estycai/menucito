import { ORDER_STATUS_LABELS, type OrderStatus } from "@menucito/shared";
import { Badge, type BadgeTone } from "@/components/ui/badge";

// One hue per stage of the flow (see the status tokens in index.css for the contrast rationale).
const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  new: "new",
  preparing: "preparing",
  ready: "ready",
  delivered: "neutral",
  cancelled: "danger",
};

export function OrderStatusBadge({ status, size }: { status: OrderStatus; size?: "sm" | "md" }) {
  return (
    <Badge tone={ORDER_STATUS_TONE[status]} size={size}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}
