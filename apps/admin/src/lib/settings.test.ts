import { describe, expect, it } from "vitest";
import type { StoreSettings } from "@menucito/shared";
import { checkSettings, sectionValues, valuesFromSettings } from "./settings";

const sampleSettings: StoreSettings = {
  acceptingOrders: true,
  minOrderCents: 100_000, // $1.000
  shippingCents: 50_000, // $500
  paymentMethods: [
    { method: "cash", enabled: true, alias: null, holderName: null },
    { method: "transfer", enabled: true, alias: "marta.mp", holderName: "Marta Gomez" },
  ],
};

const savedValues = valuesFromSettings(sampleSettings);

describe("valuesFromSettings", () => {
  it("formats cents as pesos without dollar sign", () => {
    expect(savedValues.minOrder).toBe("1.000");
    expect(savedValues.shipping).toBe("500");
    expect(savedValues.cashEnabled).toBe(true);
    expect(savedValues.transferEnabled).toBe(true);
    expect(savedValues.transferAlias).toBe("marta.mp");
    expect(savedValues.transferHolderName).toBe("Marta Gomez");
  });

  it("handles null minOrderCents as empty string", () => {
    const values = valuesFromSettings({ ...sampleSettings, minOrderCents: null });
    expect(values.minOrder).toBe("");
  });
});

describe("checkSettings", () => {
  it("returns changes: null for untouched form", () => {
    const check = checkSettings(sampleSettings, savedValues);
    expect(check.changes).toBeNull();
    expect(check.errors).toEqual({});
    expect(check.invalid).toBe(false);
  });

  it("detects changing minOrder to empty (null)", () => {
    const check = checkSettings(sampleSettings, { ...savedValues, minOrder: "" });
    expect(check.changes).toEqual({ minOrderCents: null });
    expect(check.invalid).toBe(false);
  });

  it("detects changing shipping", () => {
    const check = checkSettings(sampleSettings, { ...savedValues, shipping: "800" });
    expect(check.changes).toEqual({ shippingCents: 80_000 });
    expect(check.invalid).toBe(false);
  });

  it("rejects disabling all payment methods", () => {
    const check = checkSettings(sampleSettings, { ...savedValues, cashEnabled: false, transferEnabled: false });
    expect(check.invalid).toBe(true);
    expect(check.errors.methods).toBeDefined();
    expect(check.changes).toBeNull();
  });

  it("rejects transfer enabled without alias or holder name", () => {
    const check = checkSettings(sampleSettings, {
      ...savedValues,
      transferEnabled: true,
      transferAlias: "   ",
      transferHolderName: "",
    });
    expect(check.invalid).toBe(true);
    expect(check.errors.transferAlias).toBeDefined();
    expect(check.errors.transferHolderName).toBeDefined();
  });

  it("flags incomplete transfer warning for existing store with transfer enabled without alias", () => {
    const incompleteSettings: StoreSettings = {
      ...sampleSettings,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: null, holderName: null },
      ],
    };
    const check = checkSettings(incompleteSettings, valuesFromSettings(incompleteSettings));
    expect(check.hasIncompleteTransferWarning).toBe(true);
  });

  describe("backfilled store with transfer enabled and no alias (scenario 48)", () => {
    const incompleteSettings: StoreSettings = {
      ...sampleSettings,
      paymentMethods: [
        { method: "cash", enabled: true, alias: null, holderName: null },
        { method: "transfer", enabled: true, alias: null, holderName: null },
      ],
    };
    const incompleteValues = valuesFromSettings(incompleteSettings);

    it("can save the minimum and shipping without touching the methods, still warning", () => {
      const check = checkSettings(incompleteSettings, { ...incompleteValues, minOrder: "5000", shipping: "800" });
      expect(check.invalid).toBe(false);
      expect(check.hasIncompleteTransferWarning).toBe(true);
      expect(check.changes).toEqual({ minOrderCents: 500_000, shippingCents: 80_000 });
    });

    it("requires alias and holder for any change of the payment methods", () => {
      const check = checkSettings(incompleteSettings, { ...incompleteValues, cashEnabled: false });
      expect(check.invalid).toBe(true);
      expect(check.errors.transferAlias).toBeDefined();
      expect(check.errors.transferHolderName).toBeDefined();
      expect(check.changes).toBeNull();
    });

    it("can disable the transfer instead", () => {
      const check = checkSettings(incompleteSettings, { ...incompleteValues, transferEnabled: false });
      expect(check.invalid).toBe(false);
      expect(check.changes?.paymentMethods).toContainEqual({
        method: "transfer",
        enabled: false,
        alias: null,
        holderName: null,
      });
    });
  });
});

describe("sectionValues (one save per card)", () => {
  it("picks only the fields of the section", () => {
    expect(sectionValues("minOrder", savedValues)).toEqual({ minOrder: "1.000" });
    expect(sectionValues("shipping", savedValues)).toEqual({ shipping: "500" });
    expect(sectionValues("payments", savedValues)).toEqual({
      cashEnabled: true,
      transferEnabled: true,
      transferAlias: "marta.mp",
      transferHolderName: "Marta Gomez",
    });
  });

  it("sends only the card's own changes, reading the other fields from the saved settings", () => {
    // The payments draft was taken before the shipping changed elsewhere; the shipping is not resent.
    const draft = { ...sectionValues("payments", savedValues), cashEnabled: false };
    const latest: StoreSettings = { ...sampleSettings, shippingCents: 80_000 };
    const check = checkSettings(latest, { ...valuesFromSettings(latest), ...draft });
    expect(check.invalid).toBe(false);
    expect(Object.keys(check.changes ?? {})).toEqual(["paymentMethods"]);
  });
});
