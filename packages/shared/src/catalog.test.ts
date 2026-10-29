import { describe, expect, it } from "vitest";
import {
  CATALOG_MESSAGES,
  PRICE_MAX_CENTS,
  categoryNameSchema,
  createProductSchema,
  describeIngredient,
  formatArs,
  ingredientSchema,
  parseArsPrice,
  reorderSchema,
  replaceIngredientsSchema,
  updateProductSchema,
} from "./catalog";
import { PLAN_LIMITS, planLimitsFor } from "./plans";

describe("parseArsPrice (scenario 7)", () => {
  it.each([
    ["9.000", 900_000],
    ["9000", 900_000],
    ["9.000,50", 900_050],
    ["$ 9.000", 900_000],
    ["$9.000,5", 900_050],
    [" 123.456 ", 12_345_600],
    ["0", 0],
    ["0,99", 99],
    ["999.999,99", PRICE_MAX_CENTS],
  ])("reads %j as %i cents", (input, cents) => {
    expect(parseArsPrice(input)).toBe(cents);
  });

  it.each(["", "abc", "-100", "-9.000", "9.000,505", "1.000.000", "999.999,999", "9.00", "9,", "12.3456", "1e5", "9.000.50"])(
    "rejects %j",
    (input) => {
      expect(parseArsPrice(input)).toBeNull();
    },
  );
});

describe("formatArs", () => {
  it.each([
    [900_000, "$9.000"],
    [900_050, "$9.000,50"],
    [900_005, "$9.000,05"],
    [0, "$0"],
    [99, "$0,99"],
    [PRICE_MAX_CENTS, "$999.999,99"],
    [1_150_000, "$11.500"],
  ])("formats %i as %s", (cents, text) => {
    expect(formatArs(cents)).toBe(text);
  });

  it("round-trips through parseArsPrice", () => {
    for (const cents of [0, 5, 100, 123_456, 900_050, PRICE_MAX_CENTS]) {
      expect(parseArsPrice(formatArs(cents))).toBe(cents);
    }
  });
});

describe("categoryNameSchema (scenario 2)", () => {
  it("trims the name", () => {
    expect(categoryNameSchema.parse("  Hamburguesas ")).toBe("Hamburguesas");
  });

  it.each(["", "   ", "a".repeat(41)])("rejects %j", (name) => {
    expect(categoryNameSchema.safeParse(name).success).toBe(false);
  });

  it("accepts 40 characters", () => {
    expect(categoryNameSchema.safeParse("a".repeat(40)).success).toBe(true);
  });
});

describe("createProductSchema / updateProductSchema", () => {
  const valid = { categoryId: "c1", name: " Hamburguesa completa ", description: " Con huevo ", priceCents: 900_000, available: true };

  it("trims texts and keeps the price in cents", () => {
    expect(createProductSchema.parse(valid)).toEqual({ ...valid, name: "Hamburguesa completa", description: "Con huevo" });
  });

  it("defaults description to empty and available to true", () => {
    const parsed = createProductSchema.parse({ categoryId: "c1", name: "Veggie", priceCents: 0 });
    expect(parsed).toMatchObject({ description: "", available: true });
  });

  it.each([1.5, -1, PRICE_MAX_CENTS + 1, "900000", Number.NaN])("rejects priceCents %j", (priceCents) => {
    expect(createProductSchema.safeParse({ ...valid, priceCents }).success).toBe(false);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["a long name", { name: "a".repeat(81) }],
    ["a long description", { description: "a".repeat(301) }],
    ["a missing category", { categoryId: "" }],
  ])("rejects %s", (_label, patch) => {
    expect(createProductSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("accepts partial updates without filling defaults", () => {
    expect(updateProductSchema.parse({ available: false })).toEqual({ available: false });
    expect(updateProductSchema.safeParse({ priceCents: -1 }).success).toBe(false);
  });
});

describe("reorderSchema", () => {
  it("accepts unique ids", () => {
    expect(reorderSchema.safeParse({ ids: ["a", "b"] }).success).toBe(true);
  });

  it.each([[[]], [["a", "a"]], [["a", ""]]])("rejects %j", (ids) => {
    expect(reorderSchema.safeParse({ ids }).success).toBe(false);
  });
});

describe("ingredientSchema (scenario 5)", () => {
  const bacon = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };
  const messageFor = (patch: object) => {
    const result = ingredientSchema.safeParse({ ...bacon, ...patch });
    return result.success ? null : result.error.issues[0]?.message;
  };

  it("accepts a valid ingredient and trims the name", () => {
    expect(ingredientSchema.parse({ ...bacon, name: "  Bacon " })).toEqual(bacon);
  });

  it("accepts the limits: 40 characters, quantities 0..99, free extra", () => {
    expect(ingredientSchema.safeParse({ ...bacon, name: "a".repeat(40) }).success).toBe(true);
    expect(ingredientSchema.safeParse({ ...bacon, includedQty: 99, minQty: 99, maxQty: 99 }).success).toBe(true);
    expect(ingredientSchema.safeParse({ ...bacon, includedQty: 0, minQty: 0, maxQty: 1, extraPriceCents: 0 }).success).toBe(true);
  });

  it.each([
    ["an empty name", { name: "   " }, CATALOG_MESSAGES.ingredientNameRequired],
    ["a name over 40 characters", { name: "a".repeat(41) }, CATALOG_MESSAGES.ingredientNameTooLong],
    ["a max of 0", { includedQty: 0, minQty: 0, maxQty: 0 }, CATALOG_MESSAGES.ingredientMaxTooLow],
    ["min above included", { includedQty: 1, minQty: 2, maxQty: 3 }, CATALOG_MESSAGES.ingredientMinAboveIncluded],
    ["included above max", { includedQty: 4, minQty: 0, maxQty: 3 }, CATALOG_MESSAGES.ingredientIncludedAboveMax],
    ["a decimal quantity", { includedQty: 1.5 }, CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a negative quantity", { minQty: -1 }, CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a quantity over 99", { maxQty: 100 }, CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a text quantity", { maxQty: "3" }, CATALOG_MESSAGES.ingredientQtyInvalid],
    ["a negative extra price", { extraPriceCents: -1 }, CATALOG_MESSAGES.ingredientExtraPriceInvalid],
    ["a decimal extra price", { extraPriceCents: 1.5 }, CATALOG_MESSAGES.ingredientExtraPriceInvalid],
    ["an extra price over the maximum", { extraPriceCents: PRICE_MAX_CENTS + 1 }, CATALOG_MESSAGES.ingredientExtraPriceInvalid],
  ])("rejects %s with a Spanish message", (_label, patch, message) => {
    expect(messageFor(patch)).toBe(message);
  });

  it("points cross-field errors at the field to fix", () => {
    const result = ingredientSchema.safeParse({ ...bacon, includedQty: 4 });
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path)).toEqual([["includedQty"]]);
  });
});

describe("replaceIngredientsSchema (scenario 5)", () => {
  const item = (name: string) => ({ name, includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 0 });

  it("accepts an empty list (removes every ingredient) and keeps the order", () => {
    expect(replaceIngredientsSchema.safeParse({ ingredients: [] }).success).toBe(true);
    const parsed = replaceIngredientsSchema.parse({ ingredients: [item("Queso"), item("Bacon")] });
    expect(parsed.ingredients.map((i) => i.name)).toEqual(["Queso", "Bacon"]);
  });

  it("accepts 20 ingredients and rejects 21", () => {
    const names = Array.from({ length: 21 }, (_, i) => `Ingrediente ${i}`);
    expect(replaceIngredientsSchema.safeParse({ ingredients: names.slice(0, 20).map(item) }).success).toBe(true);
    const result = replaceIngredientsSchema.safeParse({ ingredients: names.map(item) });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.message).toBe(CATALOG_MESSAGES.ingredientsTooMany);
  });

  it("rejects duplicated names ignoring case and spaces, pointing at the repeated one", () => {
    const result = replaceIngredientsSchema.safeParse({ ingredients: [item("Bacon"), item("Queso"), item(" bacon ")] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({
        message: CATALOG_MESSAGES.ingredientNameTaken,
        path: ["ingredients", 2, "name"],
      });
    }
  });

  it.each([[undefined], [null], [{}], [{ ingredients: "x" }]])("rejects the body %j", (body) => {
    expect(replaceIngredientsSchema.safeParse(body).success).toBe(false);
  });
});

describe("describeIngredient (scenario 4)", () => {
  it("summarizes the rules of an ingredient", () => {
    expect(describeIngredient({ name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 })).toBe(
      "Bacon · incluye 1 · mín 0 · máx 3 · +$1.500 c/u extra",
    );
  });

  it("says there is no extra cost when the extra price is zero", () => {
    expect(describeIngredient({ name: "Queso", includedQty: 1, minQty: 1, maxQty: 2, extraPriceCents: 0 })).toBe(
      "Queso · incluye 1 · mín 1 · máx 2 · sin costo extra",
    );
  });
});

describe("planLimitsFor", () => {
  it("returns the limits of known plans", () => {
    expect(planLimitsFor("basic")).toBe(PLAN_LIMITS.basic);
    expect(planLimitsFor("pro")).toBe(PLAN_LIMITS.pro);
  });

  it("falls back to the most restrictive plan for unknown values", () => {
    expect(planLimitsFor("enterprise")).toBe(PLAN_LIMITS.basic);
    expect(planLimitsFor("")).toBe(PLAN_LIMITS.basic);
  });

  it("limits products on Basic only", () => {
    expect(PLAN_LIMITS.basic.maxProducts).toBeGreaterThan(0);
    expect(PLAN_LIMITS.pro.maxProducts).toBeNull();
  });

  it("allows customizable ingredients on Pro only (unknown plans included)", () => {
    expect(PLAN_LIMITS.basic.customIngredients).toBe(false);
    expect(PLAN_LIMITS.pro.customIngredients).toBe(true);
    expect(planLimitsFor("enterprise").customIngredients).toBe(false);
  });
});
