import { describe, expect, it } from "vitest";
import { CATALOG_MESSAGES } from "@menucito/shared";
import {
  NEW_INGREDIENT_VALUES,
  formValuesOf,
  ingredientFormSchema,
  sameIngredients,
  toIngredient,
  type IngredientFormValues,
} from "./ingredient-form";

const bacon: IngredientFormValues = { name: "Bacon", includedQty: "1", minQty: "0", maxQty: "3", extraPrice: "1.500" };

function errorsOf(values: Partial<IngredientFormValues>, taken: string[] = []) {
  const result = ingredientFormSchema(new Set(taken)).safeParse({ ...bacon, ...values });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
}

describe("ingredientFormSchema", () => {
  it("accepts the example of the spec and reads the price in cents", () => {
    expect(errorsOf({})).toEqual({});
    expect(toIngredient(bacon)).toEqual({ name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 });
  });

  it("treats an empty price as free", () => {
    expect(errorsOf({ extraPrice: "" })).toEqual({});
    expect(toIngredient({ ...bacon, extraPrice: "  " }).extraPriceCents).toBe(0);
  });

  it("starts from a valid blank form except for the name", () => {
    expect(errorsOf({ ...NEW_INGREDIENT_VALUES, name: "Queso" })).toEqual({});
    expect(errorsOf(NEW_INGREDIENT_VALUES)).toEqual({ name: CATALOG_MESSAGES.ingredientNameRequired });
  });

  it.each([
    ["an empty name", { name: "  " }, "name", CATALOG_MESSAGES.ingredientNameRequired],
    ["a name over 40 characters", { name: "a".repeat(41) }, "name", CATALOG_MESSAGES.ingredientNameTooLong],
    ["a max of 0", { includedQty: "0", minQty: "0", maxQty: "0" }, "maxQty", CATALOG_MESSAGES.ingredientMaxTooLow],
    ["min above included", { includedQty: "1", minQty: "2", maxQty: "3" }, "minQty", CATALOG_MESSAGES.ingredientMinAboveIncluded],
    ["included above max", { includedQty: "4", maxQty: "3" }, "includedQty", CATALOG_MESSAGES.ingredientIncludedAboveMax],
    ["a decimal quantity", { includedQty: "1.5" }, "includedQty", CATALOG_MESSAGES.ingredientQtyInvalid],
    ["an empty quantity", { maxQty: "" }, "maxQty", CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a negative quantity", { minQty: "-1" }, "minQty", CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a quantity over 99", { maxQty: "100" }, "maxQty", CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a negative price", { extraPrice: "-5" }, "extraPrice", CATALOG_MESSAGES.ingredientExtraPriceInvalid],
    ["a price that is not a price", { extraPrice: "abc" }, "extraPrice", CATALOG_MESSAGES.ingredientExtraPriceInvalid],
  ])("rejects %s on the right field", (_label, patch, field, message) => {
    expect(errorsOf(patch)[field]).toBe(message);
  });

  it("does not stack a cross-field error on a quantity that is not a number", () => {
    expect(errorsOf({ includedQty: "x" })).toEqual({ includedQty: CATALOG_MESSAGES.ingredientQtyInvalid });
  });

  it("rejects a name used by another ingredient of the product, ignoring case and spaces", () => {
    expect(errorsOf({ name: " BACON " }, ["bacon"])).toEqual({ name: CATALOG_MESSAGES.ingredientNameTaken });
    expect(errorsOf({ name: "Queso" }, ["bacon"])).toEqual({});
  });
});

describe("formValuesOf", () => {
  it("round-trips an ingredient through the form", () => {
    const ingredient = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_050 };
    expect(formValuesOf(ingredient)).toEqual({ ...bacon, extraPrice: "$1.500,50" });
    expect(toIngredient(formValuesOf(ingredient))).toEqual(ingredient);
    expect(formValuesOf({ ...ingredient, extraPriceCents: 0 }).extraPrice).toBe("0");
  });
});

describe("sameIngredients", () => {
  const a = { name: "A", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 0 };
  const b = { name: "B", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 0 };

  it("compares field by field and keeps the order", () => {
    expect(sameIngredients([a, b], [{ ...a }, { ...b }])).toBe(true);
    expect(sameIngredients([a, b], [b, a])).toBe(false);
    expect(sameIngredients([a], [{ ...a, maxQty: 4 }])).toBe(false);
    expect(sameIngredients([a], [])).toBe(false);
    expect(sameIngredients([], [])).toBe(true);
  });
});
