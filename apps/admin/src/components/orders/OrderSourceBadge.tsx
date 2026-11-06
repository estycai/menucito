import { ORDER_SOURCE_LABELS, type OrderSource } from "@menucito/shared";
import { Badge } from "@/components/ui/badge";

/** "Web", "Local" or "WhatsApp": where the order came from. */
export function OrderSourceBadge({ source }: { source: OrderSource }) {
  return <Badge tone="subtle">{ORDER_SOURCE_LABELS[source]}</Badge>;
}
