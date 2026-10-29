import { z } from "zod";
import { INGREDIENT_QTY_MAX, formatArs, type Ingredient } from "./catalog";

/** Most units a single cart line can hold. */
export const MAX_LINE_QUANTITY = 20;
/** Most distinct lines a cart can hold. */
export const MAX_CART_LINES = 30;

export const CART_MESSAGES = {
  lineLimit: `Podés pedir hasta ${MAX_LINE_QUANTITY} unidades de cada producto.`,
  cartLimit: `Tu pedido puede tener hasta ${MAX_CART_LINES} productos distintos.`,
  menuChanged: "Actualizamos tu pedido porque el menú cambió.",
} as const;

/** What the price functions need to know about a product. */
export interface PricedProduct {
  /** Base price in ARS cents. */
  priceCents: number;
  /** Customizable ingredients (empty when the product has none or the plan does not allow them). */
  ingredients: readonly Ingredient[];
}

/** Quantity chosen per ingredient, by ingredient name. */
export type Quantities = Readonly<Record<string, number>>;

/** One line of the cart: a product with a set of ingredient choices and a number of units. */
export interface CartLine {
  /** `lineKey` of the product and its choices; two additions with the same key merge. */
  key: string;
  productId: string;
  /** Units, from 1 to `MAX_LINE_QUANTITY`. */
  quantity: number;
  /** Only the ingredients whose quantity differs from the included one, by name. */
  choices: Quantities;
  /**
   * Unit price (cents) the diner saw when the line was added or last reconciled. It is never used to
   * charge anything, only to notice that the menu price changed.
   */
  unitPriceCents: number;
}

const hasOwn = (record: Quantities, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** Units charged above the included quantity, in cents. Removing units never discounts. */
export function ingredientExtraCents(ingredient: Ingredient, quantity: number): number {
  return Math.max(0, quantity - ingredient.includedQty) * ingredient.extraPriceCents;
}

/**
 * Complete quantities for every ingredient of the product: the chosen value clamped to
 * `minQty..maxQty`, or the included quantity when there is no (valid) choice. Names that are not
 * ingredients of the product are ignored.
 */
export function normalizeQuantities(
  ingredients: readonly Ingredient[],
  quantities: Quantities = {},
): Record<string, number> {
  return Object.fromEntries(
    ingredients.map((ingredient) => {
      const raw = hasOwn(quantities, ingredient.name) ? quantities[ingredient.name] : undefined;
      const wanted = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : ingredient.includedQty;
      return [ingredient.name, Math.min(ingredient.maxQty, Math.max(ingredient.minQty, wanted))];
    }),
  );
}

/** The quantities that differ from the included ones (what a cart line stores). */
export function choicesOf(ingredients: readonly Ingredient[], quantities: Quantities = {}): Record<string, number> {
  const full = normalizeQuantities(ingredients, quantities);
  return Object.fromEntries(
    ingredients.flatMap((ingredient) => {
      const quantity = full[ingredient.name] ?? ingredient.includedQty;
      return quantity === ingredient.includedQty ? [] : [[ingredient.name, quantity] as const];
    }),
  );
}

/** Price of one unit: base price plus the extras above the included quantities. */
export function unitPriceCents(product: PricedProduct, quantities: Quantities = {}): number {
  const full = normalizeQuantities(product.ingredients, quantities);
  return product.ingredients.reduce(
    (sum, ingredient) => sum + ingredientExtraCents(ingredient, full[ingredient.name] ?? ingredient.includedQty),
    product.priceCents,
  );
}

/** Price of a line: unit price times units. */
export function lineTotalCents(product: PricedProduct, quantities: Quantities, quantity: number): number {
  return unitPriceCents(product, quantities) * quantity;
}

/** Sum of the lines whose product is in `products`. Lines of unknown products count as zero. */
export function cartTotalCents(lines: readonly CartLine[], products: ReadonlyMap<string, PricedProduct>): number {
  return lines.reduce((sum, line) => {
    const product = products.get(line.productId);
    return product ? sum + lineTotalCents(product, line.choices, line.quantity) : sum;
  }, 0);
}

/** Total number of units in the cart. */
export function cartItemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Stable signature of a product and its non-default choices. Choosing the included quantity is the
 * same as choosing nothing, so both give the same key and merge into one line.
 */
export function lineKey(productId: string, ingredients: readonly Ingredient[], quantities: Quantities = {}): string {
  const pairs = Object.entries(choicesOf(ingredients, quantities)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([productId, pairs]);
}

/**
 * The lines that describe how the product differs from its base recipe, one per changed ingredient:
 * `Sin cebolla`, `Bacon x2 (+$1.500)`. Ingredients at their included quantity are left out.
 */
export function describeChanges(ingredients: readonly Ingredient[], quantities: Quantities = {}): string[] {
  const full = normalizeQuantities(ingredients, quantities);
  return ingredients.flatMap((ingredient) => {
    const quantity = full[ingredient.name] ?? ingredient.includedQty;
    if (quantity === ingredient.includedQty) return [];
    if (quantity === 0) return [`Sin ${ingredient.name.toLowerCase()}`];
    const extra = ingredientExtraCents(ingredient, quantity);
    return [extra > 0 ? `${ingredient.name} x${quantity} (+${formatArs(extra)})` : `${ingredient.name} x${quantity}`];
  });
}

export type AddToCartResult =
  | { ok: true; lines: CartLine[] }
  | { ok: false; reason: "line-limit" | "cart-limit"; message: string };

/**
 * Adds `quantity` units of a product with the given ingredient quantities. The same product with the
 * same choices merges into the existing line; excess over the limits is refused, not clamped.
 */
export function addToCart(
  lines: readonly CartLine[],
  product: PricedProduct & { id: string },
  quantities: Quantities,
  quantity: number,
): AddToCartResult {
  const units = Math.max(1, Math.floor(quantity));
  const key = lineKey(product.id, product.ingredients, quantities);
  const existing = lines.find((line) => line.key === key);

  if (existing) {
    if (existing.quantity + units > MAX_LINE_QUANTITY) {
      return { ok: false, reason: "line-limit", message: CART_MESSAGES.lineLimit };
    }
    return {
      ok: true,
      lines: lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + units } : line)),
    };
  }

  if (units > MAX_LINE_QUANTITY) return { ok: false, reason: "line-limit", message: CART_MESSAGES.lineLimit };
  if (lines.length >= MAX_CART_LINES) return { ok: false, reason: "cart-limit", message: CART_MESSAGES.cartLimit };
  const newLine: CartLine = {
    key,
    productId: product.id,
    quantity: units,
    choices: choicesOf(product.ingredients, quantities),
    unitPriceCents: unitPriceCents(product, quantities),
  };
  return { ok: true, lines: [...lines, newLine] };
}

/** Sets the units of a line, clamped to `0..MAX_LINE_QUANTITY`; zero removes the line. */
export function setLineQuantity(lines: readonly CartLine[], key: string, quantity: number): CartLine[] {
  const units = Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.floor(quantity)));
  return lines.flatMap((line) => {
    if (line.key !== key) return [line];
    return units === 0 ? [] : [{ ...line, quantity: units }];
  });
}

export function removeLine(lines: readonly CartLine[], key: string): CartLine[] {
  return lines.filter((line) => line.key !== key);
}

/** A product as the current menu describes it, for reconciling a stored cart. */
export interface MenuProduct extends PricedProduct {
  id: string;
  available: boolean;
}

const sameChoices = (a: Quantities, b: Quantities) => {
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((key) => hasOwn(b, key) && a[key] === b[key]);
};

/**
 * Brings a stored cart in line with the current menu: lines of products that no longer exist or are
 * sold out are dropped, choices are clamped to the current ingredient ranges (unknown ingredients
 * are forgotten), lines that now share a key merge, and the unit price snapshot is refreshed.
 * `changed` is true when anything the diner saw differs, so the UI can tell them once.
 */
export function reconcileCart(
  lines: readonly CartLine[],
  products: ReadonlyMap<string, MenuProduct>,
): { lines: CartLine[]; changed: boolean } {
  let changed = false;
  const merged = new Map<string, CartLine>();

  for (const line of lines) {
    const product = products.get(line.productId);
    if (!product || !product.available) {
      changed = true;
      continue;
    }
    const choices = choicesOf(product.ingredients, line.choices);
    const key = lineKey(product.id, product.ingredients, choices);
    const unit = unitPriceCents(product, choices);
    if (!sameChoices(choices, line.choices) || key !== line.key || unit !== line.unitPriceCents) changed = true;

    const existing = merged.get(key);
    if (existing) {
      changed = true;
      merged.set(key, { ...existing, quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + line.quantity) });
    } else if (merged.size < MAX_CART_LINES) {
      merged.set(key, { key, productId: product.id, quantity: line.quantity, choices, unitPriceCents: unit });
    } else {
      changed = true;
    }
  }

  return { lines: [...merged.values()], changed };
}

const cartLineSchema = z.object({
  key: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  choices: z.record(z.string(), z.number().int().min(0).max(INGREDIENT_QTY_MAX)),
  unitPriceCents: z.number().int().min(0),
});

/** Reads lines from untrusted storage: anything that is not a valid line is dropped, never thrown. */
export function parseStoredLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const lines: CartLine[] = [];
  for (const item of value) {
    const parsed = cartLineSchema.safeParse(item);
    if (parsed.success && lines.length < MAX_CART_LINES) lines.push(parsed.data);
  }
  return lines;
}
