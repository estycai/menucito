import { describe, expect, it } from "vitest";
import { planAnnualSavingsCents, planChargeCents, planLimitsFor, planMonthlyEquivalentCents } from "./plans";

describe("plan prices", () => {
  it("charges the monthly price once a month", () => {
    expect(planChargeCents("pro", "monthly")).toBe(800_000);
    expect(planMonthlyEquivalentCents("pro", "monthly")).toBe(800_000);
  });

  it("gives 20% off when billed yearly", () => {
    expect(planChargeCents("pro", "annual")).toBe(7_680_000);
    expect(planMonthlyEquivalentCents("pro", "annual")).toBe(640_000);
    expect(planAnnualSavingsCents("pro")).toBe(1_920_000);
  });

  it("keeps the free plan free in both cycles", () => {
    expect(planChargeCents("basic", "monthly")).toBe(0);
    expect(planChargeCents("basic", "annual")).toBe(0);
    expect(planAnnualSavingsCents("basic")).toBe(0);
  });

  it("includes Reports only in Pro", () => {
    expect(planLimitsFor("basic").reports).toBe(false);
    expect(planLimitsFor("pro").reports).toBe(true);
  });
});
