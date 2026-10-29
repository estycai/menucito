import { z } from "zod";
import {
  CATALOG_MESSAGES,
  formatArs,
  ingredientNameKey,
  ingredientSchema,
  parseArsPrice,
  type Ingredient,
} from "@menucito/shared";

/** Values of the ingredient form as typed: numbers and the price stay strings until validated. */
export interface IngredientFormValues {
  name: string;
  includedQty: string;
  minQty: string;
  maxQty: string;
  /** Argentine price per extra unit (`1.500`); empty means free. */
  extraPrice: string;
}

export const NEW_INGREDIENT_VALUES: IngredientFormValues = {
  name: "",
  includedQty: "1",
  minQty: "0",
  maxQty: "3",
  extraPrice: "0",
};

export function formValuesOf(ingredient: Ingredient): IngredientFormValues {
  return {
    name: ingredient.name,
    includedQty: String(ingredient.includedQty),
    minQty: String(ingredient.minQty),
    maxQty: String(ingredient.maxQty),
    extraPrice: ingredient.extraPriceCents > 0 ? formatArs(ingredient.extraPriceCents) : "0",
  };
}

const QTY_FIELDS = ["includedQty", "minQty", "maxQty"] as const;
const QTY_PATTERN = /^\d{1,2}$/;
const qtyText = z.string().trim().regex(QTY_PATTERN, CATALOG_MESSAGES.ingredientQtyInvalid);

/**
 * Schema of the ingredient form. The rules are the ones of `ingredientSchema` (shared with the API);
 * this only adds the text-to-number step and the duplicated-name check against `takenNames`
 * (lowercase keys of the other ingredients of the product).
 */
export function ingredientFormSchema(takenNames: ReadonlySet<string>) {
  return z
    .object({
      name: z.string(),
      includedQty: qtyText,
      minQty: qtyText,
      maxQty: qtyText,
      extraPrice: z.string().trim(),
    })
    .superRefine((values, ctx) => {
      const qtysTyped = QTY_FIELDS.every((field) => QTY_PATTERN.test(values[field].trim()));
      const parsed = ingredientSchema.safeParse(toIngredient(values));
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const [field] = issue.path;
        // Quantity fields that are not numbers were already reported by their own check.
        if (!qtysTyped && field !== "name" && field !== "extraPriceCents") continue;
        ctx.addIssue({ code: "custom", message: issue.message, path: field === "extraPriceCents" ? ["extraPrice"] : issue.path });
      }
      if (takenNames.has(ingredientNameKey(values.name))) {
        ctx.addIssue({ code: "custom", message: CATALOG_MESSAGES.ingredientNameTaken, path: ["name"] });
      }
    });
}

/**
 * Typed values as an `Ingredient`, not validated: bad numbers become `NaN` and a bad price `-1`,
 * which `ingredientSchema` then rejects.
 */
export function toIngredient(values: IngredientFormValues): Ingredient {
  const price = values.extraPrice.trim() === "" ? 0 : parseArsPrice(values.extraPrice);
  const qty = (text: string) => (QTY_PATTERN.test(text.trim()) ? Number(text.trim()) : 0);
  return {
    name: values.name,
    includedQty: qty(values.includedQty),
    minQty: qty(values.minQty),
    maxQty: qty(values.maxQty),
    extraPriceCents: price ?? -1,
  };
}

export function sameIngredients(a: readonly Ingredient[], b: readonly Ingredient[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        item.name === other.name &&
        item.includedQty === other.includedQty &&
        item.minQty === other.minQty &&
        item.maxQty === other.maxQty &&
        item.extraPriceCents === other.extraPriceCents
      );
    })
  );
}
