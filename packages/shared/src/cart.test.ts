import { describe, expect, it } from "vitest";
import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  addToCart,
  cartItemCount,
  cartTotalCents,
  choicesOf,
  describeChanges,
  ingredientExtraCents,
  lineKey,
  lineTotalCents,
  normalizeQuantities,
  parseStoredLines,
  reconcileCart,
  removeLine,
  setLineQuantity,
  unitPriceCents,
  type CartLine,
  type MenuProduct,
} from "./cart";
import type { Ingredient } from "./catalog";

const bacon: Ingredient = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };
const onion: Ingredient = { name: "Cebolla", includedQty: 1, minQty: 0, maxQty: 2, extraPriceCents: 0 };
const burger = { id: "p1", priceCents: 900_000, ingredients: [bacon, onion] };
const drink = { id: "p2", priceCents: 350_000, ingredients: [] as Ingredient[] };

describe("price rules (scenario 13)", () => {
  it("charges only the units above the included quantity", () => {
    expect(ingredientExtraCents(bacon, 0)).toBe(0);
    expect(ingredientExtraCents(bacon, 1)).toBe(0);
    expect(ingredientExtraCents(bacon, 2)).toBe(150_000);
    expect(ingredientExtraCents(bacon, 3)).toBe(300_000);
  });

  it("prices the worked example: Bacon x2 and no onion is $10.500 a unit and $21.000 for two", () => {
    const quantities = { Bacon: 2, Cebolla: 0 };
    expect(unitPriceCents(burger, quantities)).toBe(1_050_000);
    expect(lineTotalCents(burger, quantities, 2)).toBe(2_100_000);
  });

  it("never discounts for removed ingredients", () => {
    expect(unitPriceCents(burger, { Bacon: 0, Cebolla: 0 })).toBe(900_000);
  });

  it("uses the base price when there are no choices or no ingredients", () => {
    expect(unitPriceCents(burger)).toBe(900_000);
    expect(unitPriceCents(drink, { Bacon: 3 })).toBe(350_000);
  });

  it("clamps out of range choices before pricing", () => {
    expect(unitPriceCents(burger, { Bacon: 99 })).toBe(900_000 + 2 * 150_000);
    expect(unitPriceCents(burger, { Bacon: -4 })).toBe(900_000);
  });

  it("totals the cart and ignores lines of unknown products", () => {
    const products = new Map([
      ["p1", burger],
      ["p2", drink],
    ]);
    const lines = [
      addLine([], burger, { Bacon: 2 }, 2),
      addLine([], drink, {}, 1),
      { key: "x", productId: "gone", quantity: 5, choices: {}, unitPriceCents: 1 },
    ].flat();
    expect(cartTotalCents(lines, products)).toBe(2 * 1_050_000 + 350_000);
    expect(cartItemCount(lines)).toBe(2 + 1 + 5);
  });
});

function addLine(lines: CartLine[], product: typeof burger, quantities: Record<string, number>, quantity: number) {
  const result = addToCart(lines, product, quantities, quantity);
  if (!result.ok) throw new Error(result.message);
  return result.lines;
}

describe("normalizeQuantities and choicesOf", () => {
  it("fills the included defaults and clamps to min and max", () => {
    expect(normalizeQuantities([bacon, onion], { Bacon: 9 })).toEqual({ Bacon: 3, Cebolla: 1 });
    expect(normalizeQuantities([bacon, onion], { Cebolla: -1 })).toEqual({ Bacon: 1, Cebolla: 0 });
  });

  it("ignores names that are not ingredients and values that are not numbers", () => {
    expect(normalizeQuantities([bacon], { Queso: 3, Bacon: Number.NaN })).toEqual({ Bacon: 1 });
    expect(normalizeQuantities([bacon], { __proto__: 2 } as never)).toEqual({ Bacon: 1 });
  });

  it("keeps only the choices that differ from the included quantity", () => {
    expect(choicesOf([bacon, onion], { Bacon: 1, Cebolla: 0 })).toEqual({ Cebolla: 0 });
    expect(choicesOf([bacon, onion], {})).toEqual({});
  });
});

describe("lineKey and merging (scenario 4)", () => {
  it("is the same for the same choices in any order, and for explicit defaults", () => {
    expect(lineKey("p1", burger.ingredients, { Bacon: 2, Cebolla: 0 })).toBe(
      lineKey("p1", burger.ingredients, { Cebolla: 0, Bacon: 2 }),
    );
    expect(lineKey("p1", burger.ingredients, { Bacon: 1, Cebolla: 1 })).toBe(lineKey("p1", burger.ingredients, {}));
  });

  it("differs by product and by choices", () => {
    expect(lineKey("p1", burger.ingredients, { Bacon: 2 })).not.toBe(lineKey("p1", burger.ingredients, { Bacon: 3 }));
    expect(lineKey("p1", burger.ingredients, {})).not.toBe(lineKey("p2", burger.ingredients, {}));
  });

  it("merges the same product with the same choices and separates different ones", () => {
    let lines = addLine([], burger, { Bacon: 2 }, 1);
    lines = addLine(lines, burger, { Bacon: 2 }, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);

    lines = addLine(lines, burger, { Bacon: 3 }, 1);
    lines = addLine(lines, burger, {}, 1);
    expect(lines).toHaveLength(3);
  });

  it("stores the choices that differ and a price snapshot", () => {
    const [line] = addLine([], burger, { Bacon: 2, Cebolla: 1 }, 1);
    expect(line?.choices).toEqual({ Bacon: 2 });
    expect(line?.unitPriceCents).toBe(1_050_000);
  });
});

describe("limits (scenario 4)", () => {
  it("refuses to go over 20 units in a line, without changing the cart", () => {
    const lines = addLine([], drink, {}, MAX_LINE_QUANTITY);
    const result = addToCart(lines, drink, {}, 1);
    expect(result).toMatchObject({ ok: false, reason: "line-limit" });
    expect(lines[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(addToCart([], drink, {}, MAX_LINE_QUANTITY + 1)).toMatchObject({ ok: false, reason: "line-limit" });
  });

  it("refuses a 31st line but still merges into an existing one", () => {
    let lines: CartLine[] = [];
    for (let index = 0; index < MAX_CART_LINES; index++) {
      lines = addLine(lines, { ...drink, id: `p${index}` }, {}, 1);
    }
    expect(addToCart(lines, { ...drink, id: "extra" }, {}, 1)).toMatchObject({ ok: false, reason: "cart-limit" });
    expect(addToCart(lines, { ...drink, id: "p0" }, {}, 1)).toMatchObject({ ok: true });
  });

  it("sets, clamps and removes lines", () => {
    const lines = addLine([], drink, {}, 2);
    const key = lines[0]?.key ?? "";
    expect(setLineQuantity(lines, key, 5)[0]?.quantity).toBe(5);
    expect(setLineQuantity(lines, key, 500)[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(setLineQuantity(lines, key, 0)).toEqual([]);
    expect(removeLine(lines, key)).toEqual([]);
    expect(removeLine(lines, "other")).toEqual(lines);
  });
});

describe("describeChanges", () => {
  it("lists only what differs from the included quantity", () => {
    expect(describeChanges([bacon, onion], { Bacon: 2, Cebolla: 0 })).toEqual(["Bacon x2 (+$1.500)", "Sin cebolla"]);
    expect(describeChanges([bacon, onion], {})).toEqual([]);
    expect(describeChanges([bacon, onion], { Bacon: 1, Cebolla: 1 })).toEqual([]);
  });

  it("shows the sum of the extras of an ingredient and omits the price when it is free", () => {
    expect(describeChanges([bacon], { Bacon: 3 })).toEqual(["Bacon x3 (+$3.000)"]);
    expect(describeChanges([onion], { Cebolla: 2 })).toEqual(["Cebolla x2"]);
  });

  it("describes a reduction that is not a full removal", () => {
    const cheese: Ingredient = { name: "Queso", includedQty: 3, minQty: 0, maxQty: 4, extraPriceCents: 100_000 };
    expect(describeChanges([cheese], { Queso: 1 })).toEqual(["Queso x1"]);
  });
});

describe("reconcileCart (scenario 7)", () => {
  const menu = (...products: MenuProduct[]) => new Map(products.map((product) => [product.id, product]));
  const current = (product: typeof burger, available = true): MenuProduct => ({ ...product, available });

  it("keeps an unchanged cart as is", () => {
    const lines = addLine([], burger, { Bacon: 2 }, 2);
    const result = reconcileCart(lines, menu(current(burger)));
    expect(result.changed).toBe(false);
    expect(result.lines).toEqual(lines);
  });

  it("drops products that disappeared or are sold out", () => {
    const lines = addLine(addLine([], burger, {}, 1), drink, {}, 1);
    expect(reconcileCart(lines, menu(current(burger, false), current(drink)))).toMatchObject({
      changed: true,
      lines: [{ productId: "p2" }],
    });
    expect(reconcileCart(lines, menu(current(drink))).lines.map((line) => line.productId)).toEqual(["p2"]);
  });

  it("uses the current price and tells the diner", () => {
    const lines = addLine([], drink, {}, 1);
    const repriced = { ...drink, priceCents: 400_000 };
    const result = reconcileCart(lines, menu(current(repriced)));
    expect(result.changed).toBe(true);
    expect(result.lines[0]?.unitPriceCents).toBe(400_000);
  });

  it("clamps to a changed ingredient range and forgets removed ingredients", () => {
    const lines = addLine([], burger, { Bacon: 3, Cebolla: 0 }, 1);
    const narrowed = { ...burger, ingredients: [{ ...bacon, maxQty: 2 }] };
    const [line] = reconcileCart(lines, menu(current(narrowed))).lines;
    expect(line?.choices).toEqual({ Bacon: 2 });
    expect(line?.key).toBe(lineKey("p1", narrowed.ingredients, { Bacon: 2 }));
  });

  it("merges lines that become identical, capped at the line limit", () => {
    const a = addLine([], burger, { Bacon: 3 }, 15);
    const b = addLine(a, burger, { Bacon: 2 }, 15);
    expect(b).toHaveLength(2);
    const narrowed = { ...burger, ingredients: [{ ...bacon, maxQty: 2 }] };
    const result = reconcileCart(b, menu(current(narrowed)));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.quantity).toBe(MAX_LINE_QUANTITY);
    expect(result.changed).toBe(true);
  });
});

describe("parseStoredLines", () => {
  const valid = { key: "k", productId: "p", quantity: 2, choices: { Bacon: 2 }, unitPriceCents: 10 };

  it("accepts valid lines and drops anything else", () => {
    expect(parseStoredLines([valid, { ...valid, quantity: 0 }, { ...valid, quantity: 21 }, "x", null, { key: 1 }])).toEqual([
      valid,
    ]);
  });

  it("returns an empty cart for values that are not a list", () => {
    expect(parseStoredLines(null)).toEqual([]);
    expect(parseStoredLines({})).toEqual([]);
    expect(parseStoredLines("[]")).toEqual([]);
  });

  it("never returns more than the cart limit", () => {
    expect(parseStoredLines(Array.from({ length: 50 }, () => valid))).toHaveLength(MAX_CART_LINES);
  });
});
