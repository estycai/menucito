import { useState } from "react";
import {
  MAX_LINE_QUANTITY,
  formatArs,
  ingredientExtraCents,
  lineTotalCents,
  normalizeQuantities,
  type PublicMenuProduct,
  type Quantities,
} from "@menucito/shared";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";

interface ManualProductDialogProps {
  product: PublicMenuProduct;
  initialChoices?: Quantities;
  initialQuantity?: number;
  onConfirm: (choices: Quantities, quantity: number) => void;
  onClose: () => void;
}

/** Options of a product with ingredients before adding it to a manual order (same rules as the web). */
export function ManualProductDialog({
  product,
  initialChoices = {},
  initialQuantity = 1,
  onConfirm,
  onClose,
}: ManualProductDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    normalizeQuantities(product.ingredients, initialChoices),
  );
  const [quantity, setQuantity] = useState(initialQuantity);

  return (
    <Modal title={product.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {product.ingredients.map((ingredient) => {
            const selected = quantities[ingredient.name] ?? ingredient.includedQty;
            const extra = ingredientExtraCents(ingredient, selected);
            return (
              <li key={ingredient.name} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-ink">{ingredient.name}</span>
                  <span className="text-xs text-muted">
                    Incluye {ingredient.includedQty}
                    {ingredient.extraPriceCents > 0 && ` · cada extra ${formatArs(ingredient.extraPriceCents)}`}
                  </span>
                  {extra > 0 && <span className="text-xs font-bold text-primary">+{formatArs(extra)}</span>}
                </div>
                <Stepper
                  label={ingredient.name}
                  value={selected}
                  min={ingredient.minQty}
                  max={ingredient.maxQty}
                  onChange={(next) => setQuantities((current) => ({ ...current, [ingredient.name]: next }))}
                />
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-sm font-bold text-ink">Cantidad</span>
          <Stepper
            label="Cantidad"
            value={quantity}
            min={1}
            max={MAX_LINE_QUANTITY}
            onChange={setQuantity}
          />
        </div>

        <Button
          type="button"
          onClick={() => onConfirm(quantities, quantity)}
          className="min-h-11 w-full text-sm font-bold"
        >
          Agregar · {formatArs(lineTotalCents(product, quantities, quantity))}
        </Button>
      </div>
    </Modal>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label={`Quitar ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="size-10 min-h-10 p-0 text-lg"
      >
        −
      </Button>
      <span aria-live="polite" className="w-6 text-center text-sm font-bold text-ink">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        aria-label={`Agregar ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="size-10 min-h-10 p-0 text-lg"
      >
        +
      </Button>
    </span>
  );
}
