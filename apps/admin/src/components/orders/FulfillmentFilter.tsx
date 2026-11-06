import { FULFILLMENT_LABELS } from "@menucito/shared";
import type { FulfillmentMode } from "@/lib/orders";
import { cn } from "@/lib/utils";

interface FulfillmentFilterProps {
  value: FulfillmentMode | null;
  /** Active orders without filtering, for the "Todos (n)" count. */
  total: number;
  onChange: (value: FulfillmentMode | null) => void;
}

/** `Todos (n) | Envío | Retiro` segment of the board and the Individual view. */
export function FulfillmentFilter({ value, total, onChange }: FulfillmentFilterProps) {
  const option = (mode: FulfillmentMode | null, label: string) => (
    <button
      type="button"
      aria-pressed={value === mode}
      onClick={() => onChange(mode)}
      className={cn(
        "min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        value === mode ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );

  return (
    <div role="group" aria-label="Filtrar por modalidad" className="flex rounded-xl bg-tab p-1">
      {option(null, `Todos (${total})`)}
      {option("delivery", FULFILLMENT_LABELS.delivery)}
      {option("takeaway", FULFILLMENT_LABELS.takeaway)}
    </div>
  );
}
