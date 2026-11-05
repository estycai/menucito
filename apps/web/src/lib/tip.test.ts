import { describe, expect, it } from "vitest";
import { TIP_MAX_CENTS, TIP_MESSAGES, TIP_PERCENTAGES, tipFromPercent } from "@menucito/shared";
import { tipAllowed, tipCentsFor, tipOtherCents, tipOtherError } from "./tip";

// Scenarios 35 to 38 of change 13: the pure logic behind the tip selector.

describe("13 scenario 35: no option is picked by default", () => {
  it("returns a zero tip when nothing is chosen", () => {
    expect(tipCentsFor(null, "", 2_850_000)).toBe(0);
    expect(tipCentsFor(null, "3000", 2_850_000)).toBe(0);
  });

  it("calculates every percentage over the products subtotal", () => {
    const subtotal = 2_850_000;
    for (const percent of TIP_PERCENTAGES) {
      expect(tipCentsFor(percent, "", subtotal)).toBe(tipFromPercent(subtotal, percent));
    }
    expect(tipCentsFor(10, "", subtotal)).toBe(285_000);
  });
});

describe("13 scenario 37: Otro monto accepts whole pesos from 0 to 50.000", () => {
  it("turns whole pesos into cents", () => {
    expect(tipCentsFor("other", "3000", 2_850_000)).toBe(300_000);
    expect(tipCentsFor("other", "50.000".replace(".", ""), 2_850_000)).toBe(TIP_MAX_CENTS);
    expect(tipCentsFor("other", "", 2_850_000)).toBe(0);
    expect(tipCentsFor("other", "0", 2_850_000)).toBe(0);
  });

  it("flags anything that is not a whole peso amount in range", () => {
    expect(tipOtherError("")).toBeUndefined();
    expect(tipOtherError("0")).toBeUndefined();
    expect(tipOtherError("3000")).toBeUndefined();
    expect(tipOtherError("50000")).toBeUndefined();
    expect(tipOtherError("50001")).toBe(TIP_MESSAGES.invalidAmount);
    expect(tipOtherError("-1")).toBe(TIP_MESSAGES.invalidAmount);
    expect(tipOtherError("3,5")).toBe(TIP_MESSAGES.invalidAmount);
    expect(tipOtherError("3000.50")).toBe(TIP_MESSAGES.invalidAmount);
    expect(tipOtherError("abc")).toBe(TIP_MESSAGES.invalidAmount);
  });

  it("returns null instead of cents when the amount is invalid", () => {
    expect(tipOtherCents("50001")).toBeNull();
    expect(tipOtherCents("3000")).toBe(300_000);
    expect(tipOtherCents("")).toBe(0);
  });

  it("computes a zero tip for an invalid custom amount so the total never moves", () => {
    expect(tipCentsFor("other", "50001", 2_850_000)).toBe(0);
    expect(tipCentsFor("other", "abc", 2_850_000)).toBe(0);
  });
});

describe("13 scenario 36: a tip only exists on delivery paid by transfer", () => {
  it("enables the selector only for delivery + transfer", () => {
    expect(tipAllowed("delivery", "transfer")).toBe(true);
    expect(tipAllowed("delivery", "cash")).toBe(false);
    expect(tipAllowed("takeaway", "transfer")).toBe(false);
    expect(tipAllowed("takeaway", "cash")).toBe(false);
  });

  it("stays disabled until both choices are picked", () => {
    expect(tipAllowed("", "")).toBe(false);
    expect(tipAllowed("delivery", "")).toBe(false);
    expect(tipAllowed("", "transfer")).toBe(false);
  });
});
