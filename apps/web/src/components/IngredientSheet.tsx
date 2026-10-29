import { useEffect, useRef, useState } from "preact/hooks";
import {
  MAX_LINE_QUANTITY,
  formatArs,
  ingredientExtraCents,
  lineTotalCents,
  normalizeQuantities,
  type PricedProduct,
  type Quantities,
} from "@menucito/shared";
import { Stepper } from "./Stepper";

interface IngredientSheetProps {
  product: PricedProduct & { id: string; name: string };
  /** Called for every way of closing, including Escape, which the browser handles itself. */
  onClose: () => void;
  /** Adds to the cart; returns the reason it was refused, or `null` when it worked. */
  onConfirm: (quantities: Quantities, units: number) => string | null;
}

/**
 * Bottom sheet on a native modal `<dialog>`: the browser contains focus, closes on Escape and draws
 * the backdrop. Mounted only while open, it starts every time at the included quantities.
 */
export function IngredientSheet({ product, onClose, onConfirm }: IngredientSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => normalizeQuantities(product.ingredients));
  const [units, setUnits] = useState(1);
  const [refusal, setRefusal] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  const titleId = `sheet-title-${product.id}`;
  // Closing by hand notifies the parent right away instead of waiting for the `close` event, which the
  // browser may dispatch late; Escape still arrives through the event. `onClose` is idempotent.
  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      class="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop targets the dialog itself; the panel fills the rest of it.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div class="sheet-panel">
        <header class="sheet-header">
          <h2 class="sheet-title" id={titleId}>
            {product.name}
          </h2>
          <button type="button" class="icon-button" aria-label="Cerrar" onClick={close}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <ul class="sheet-ingredients">
          {product.ingredients.map((ingredient) => {
            const quantity = quantities[ingredient.name] ?? ingredient.includedQty;
            const extra = ingredientExtraCents(ingredient, quantity);
            return (
              <li class="sheet-ingredient" key={ingredient.name}>
                <div class="sheet-ingredient-text">
                  <span class="sheet-ingredient-name">{ingredient.name}</span>
                  <span class="sheet-ingredient-meta">
                    Incluye {ingredient.includedQty}
                    {ingredient.extraPriceCents > 0 && ` · cada extra ${formatArs(ingredient.extraPriceCents)}`}
                  </span>
                  {extra > 0 && <span class="sheet-ingredient-extra">+{formatArs(extra)}</span>}
                </div>
                <Stepper
                  name={ingredient.name}
                  value={quantity}
                  min={ingredient.minQty}
                  max={ingredient.maxQty}
                  onChange={(value) => {
                    setRefusal("");
                    setQuantities((current) => ({ ...current, [ingredient.name]: value }));
                  }}
                />
              </li>
            );
          })}
        </ul>

        <div class="sheet-units">
          <span class="sheet-units-label">Cantidad</span>
          <Stepper
            name={product.name}
            value={units}
            min={1}
            max={MAX_LINE_QUANTITY}
            onChange={(value) => {
              setRefusal("");
              setUnits(value);
            }}
          />
        </div>

        {refusal && (
          <p class="sheet-refusal" role="alert">
            {refusal}
          </p>
        )}

        <button
          type="button"
          class="primary-button"
          onClick={() => {
            const reason = onConfirm(quantities, units);
            if (reason) setRefusal(reason);
            else close();
          }}
        >
          Agregar ·{" "}
          <span aria-live="polite" aria-atomic="true">
            {formatArs(lineTotalCents(product, quantities, units))}
          </span>
        </button>
      </div>
    </dialog>
  );
}
