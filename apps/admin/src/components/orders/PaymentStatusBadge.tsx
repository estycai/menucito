import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@menucito/shared";
import { Badge } from "@/components/ui/badge";

export function PaymentStatusBadge({ status, size }: { status: PaymentStatus; size?: "sm" | "md" }) {
  return (
    <Badge tone={status === "paid" ? "success" : "warning"} size={size}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
