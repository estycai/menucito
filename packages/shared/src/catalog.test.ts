import { describe, expect, it } from "vitest";
import {
  PRICE_MAX_CENTS,
  categoryNameSchema,
  createProductSchema,
  formatArs,
  parseArsPrice,
  reorderSchema,
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
});
