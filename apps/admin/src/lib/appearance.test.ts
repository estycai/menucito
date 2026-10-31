import { describe, expect, it } from "vitest";
import { DEFAULT_COLORS, RESTAURANT_MESSAGES, type Restaurant } from "@menucito/shared";
import { canCustomizeColors, checkAppearance, draftColors, valuesFromRestaurant } from "./appearance";

const restaurant: Restaurant = {
  id: "r1",
  slug: "lo-de-marta",
  name: "Lo de Marta",
  whatsapp: "5491112345678",
  delivery: true,
  takeaway: true,
  logoUrl: null,
  coverUrl: null,
  description: "Hamburguesas caseras",
  bgColor: null,
  primaryColor: null,
  plan: "pro",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const saved = valuesFromRestaurant(restaurant);

describe("valuesFromRestaurant", () => {
  it("shows the Menucito colors where none was saved", () => {
    expect(saved).toEqual({ description: "Hamburguesas caseras", bgColor: "#F7F5F2", primaryColor: "#C2410C" });
  });

  it("shows the saved colors", () => {
    expect(valuesFromRestaurant({ ...restaurant, bgColor: "#1C1917" }).bgColor).toBe("#1C1917");
  });
});

describe("canCustomizeColors", () => {
  it("follows the plan limits", () => {
    expect(canCustomizeColors(restaurant)).toBe(true);
    expect(canCustomizeColors({ ...restaurant, plan: "basic" })).toBe(false);
  });
});

describe("checkAppearance", () => {
  it("reports no changes for the untouched form", () => {
    expect(checkAppearance(restaurant, saved, true)).toEqual({ changes: null, errors: {}, warnings: {}, invalid: false });
  });

  it("sends only the changed keys", () => {
    const check = checkAppearance(restaurant, { ...saved, description: "Nuevo" }, true);
    expect(check.changes).toEqual({ description: "Nuevo" });
  });

  it("normalizes the description before comparing and sending", () => {
    expect(checkAppearance(restaurant, { ...saved, description: "  Hamburguesas   caseras \n" }, true).changes).toBeNull();
    expect(checkAppearance(restaurant, { ...saved, description: "  Hola \n mundo " }, true).changes).toEqual({ description: "Hola mundo" });
  });

  it("allows emptying the description", () => {
    expect(checkAppearance(restaurant, { ...saved, description: "" }, true).changes).toEqual({ description: "" });
  });

  it("rejects a description over the limit after normalizing", () => {
    const check = checkAppearance(restaurant, { ...saved, description: "a".repeat(121) }, true);
    expect(check.invalid).toBe(true);
    expect(check.errors.description).toBe(RESTAURANT_MESSAGES.descriptionTooLong);
    expect(check.changes).toBeNull();
  });

  it("normalizes colors typed as #RGB or without #", () => {
    const check = checkAppearance(restaurant, { ...saved, bgColor: "fff", primaryColor: "#15803d" }, true);
    expect(check.changes).toEqual({ bgColor: "#FFFFFF", primaryColor: "#15803D" });
  });

  it("flags a color that is not hexadecimal", () => {
    const check = checkAppearance(restaurant, { ...saved, bgColor: "rgb(0,0,0)", primaryColor: "#12" }, true);
    expect(check.errors).toEqual({ bgColor: RESTAURANT_MESSAGES.colorInvalid, primaryColor: RESTAURANT_MESSAGES.colorInvalid });
    expect(check.invalid).toBe(true);
  });

  it("warns about a primary color that barely differs from the background, without blocking the save", () => {
    const check = checkAppearance(restaurant, { ...saved, bgColor: "#1C1917", primaryColor: "#1D4ED8" }, true);
    expect(check.warnings.primaryColor).toBe(RESTAURANT_MESSAGES.colorContrast);
    expect(check.errors).toEqual({});
    expect(check.invalid).toBe(false);
    expect(check.changes).toEqual({ bgColor: "#1C1917", primaryColor: "#1D4ED8" });
  });

  it("keeps a low-contrast pair as a warning while another field has a real error", () => {
    const check = checkAppearance(restaurant, { ...saved, description: "a".repeat(121), bgColor: "#1C1917", primaryColor: "#1D4ED8" }, true);
    expect(check.warnings.primaryColor).toBe(RESTAURANT_MESSAGES.colorContrast);
    expect(check.invalid).toBe(true);
  });

  it("does not warn while a color is not a valid hex", () => {
    const check = checkAppearance(restaurant, { ...saved, primaryColor: "#12" }, true);
    expect(check.warnings).toEqual({});
    expect(check.errors.primaryColor).toBe(RESTAURANT_MESSAGES.colorInvalid);
  });

  it("judges a changed background against the saved primary color", () => {
    const withBlue = { ...restaurant, primaryColor: "#1D4ED8" };
    const check = checkAppearance(withBlue, { ...valuesFromRestaurant(withBlue), bgColor: "#1C1917" }, true);
    expect(check.warnings.primaryColor).toBe(RESTAURANT_MESSAGES.colorContrast);
    expect(check.invalid).toBe(false);
  });

  it("sends null when a color goes back to the default", () => {
    const withColors = { ...restaurant, bgColor: "#FFFFFF", primaryColor: "#15803D" };
    const reset = { ...valuesFromRestaurant(withColors), bgColor: DEFAULT_COLORS.background, primaryColor: DEFAULT_COLORS.primary };
    expect(checkAppearance(withColors, reset, true).changes).toEqual({ bgColor: null, primaryColor: null });
  });

  it("never sends or validates color keys when the plan has no custom colors", () => {
    const basic = { ...restaurant, plan: "basic", bgColor: "#FFFFFF" };
    const values = { description: "Nuevo", bgColor: "nope", primaryColor: "#1D4ED8" };
    const check = checkAppearance(basic, values, canCustomizeColors(basic));
    expect(check.changes).toEqual({ description: "Nuevo" });
    expect(check.invalid).toBe(false);
  });
});

describe("draftColors", () => {
  it("uses the typed colors", () => {
    expect(draftColors(restaurant, { ...saved, bgColor: "#fff", primaryColor: "#15803D" }, true)).toEqual({
      background: "#FFFFFF",
      primary: "#15803D",
    });
  });

  it("keeps the saved (or default) color while the typed one is invalid", () => {
    const withBlue = { ...restaurant, primaryColor: "#1D4ED8" };
    expect(draftColors(withBlue, { ...saved, bgColor: "#12", primaryColor: "#zz" }, true)).toEqual({
      background: "#F7F5F2",
      primary: "#1D4ED8",
    });
  });

  it("uses the Menucito defaults on plans without custom colors, even with colors saved", () => {
    const basic = { ...restaurant, plan: "basic", bgColor: "#1C1917" };
    expect(draftColors(basic, { ...saved, bgColor: "#1C1917" }, false)).toEqual(DEFAULT_COLORS);
  });
});
