import { useEffect, useRef, useState } from "preact/hooks";
import { MAX_LINE_QUANTITY, lineKey, type Quantities } from "@menucito/shared";
import type { CatalogProduct } from "../lib/catalog";
import { useCart } from "../lib/use-cart";
import { IngredientSheet } from "./IngredientSheet";
import { Stepper } from "./Stepper";

interface AddControlProps {
  slug: string;
  product: CatalogProduct;
}

/**
 * The add control of one available product. A product without customizable ingredients gets an
 * "Agregar" button that turns into a − N + stepper; one with ingredients opens the sheet every time.
 */
export function AddControl({ slug, product }: AddControlProps) {
  const { state, store } = useCart(slug);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refusal, setRefusal] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const stepperRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"add" | "stepper" | null>(null);

  const customizable = product.ingredients.length > 0;
  const plainKey = lineKey(product.id, product.ingredients, {});
  const plainLine = state.lines.find((line) => line.key === plainKey);
  const inCart = state.lines.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.quantity, 0);
  const showStepper = !customizable && plainLine !== undefined;

  // The control that had focus disappears when the button turns into a stepper and back.
  useEffect(() => {
    if (pendingFocus.current === "stepper") stepperRef.current?.querySelectorAll("button")[1]?.focus();
    if (pendingFocus.current === "add") addRef.current?.focus();
    pendingFocus.current = null;
  }, [showStepper]);

  const tryAdd = (quantities: Quantities, units: number): string | null => {
    const result = store.add(product, quantities, units);
    return result.ok ? null : result.message;
  };

  if (showStepper && plainLine) {
    return (
      <div class="add-control" ref={stepperRef}>
        <Stepper
          name={product.name}
          value={plainLine.quantity}
          min={0}
          max={MAX_LINE_QUANTITY}
          onChange={(value) => {
            if (value === 0) pendingFocus.current = "add";
            store.setQuantity(plainLine.key, value);
          }}
        />
      </div>
    );
  }

  return (
    <div class="add-control">
      {customizable && inCart > 0 && (
        <span class="in-cart" aria-live="polite">
          En tu pedido: {inCart}
        </span>
      )}
      <button
        type="button"
        class="add-button"
        ref={addRef}
        aria-label={`Agregar ${product.name}`}
        aria-haspopup={customizable ? "dialog" : undefined}
        onClick={() => {
          setRefusal("");
          if (customizable) {
            setSheetOpen(true);
            return;
          }
          const reason = tryAdd({}, 1);
          if (reason) setRefusal(reason);
          else pendingFocus.current = "stepper";
        }}
      >
        Agregar
      </button>
      {refusal && (
        <p class="add-refusal" role="alert">
          {refusal}
        </p>
      )}
      {sheetOpen && (
        <IngredientSheet
          product={product}
          onConfirm={tryAdd}
          onClose={() => {
            setSheetOpen(false);
            addRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
