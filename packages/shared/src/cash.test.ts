import { describe, expect, it } from "vitest";
import {
  cashDifference,
  cashTotalsFromSnapshot,
  closeCashSessionSchema,
  computeCashTotals,
  courierChangeBackSuggestion,
  courierChangeSuggestion,
  courierPaymentSuggestion,
  createCashMovementSchema,
  formatCashDifference,
  groupCashMovements,
  maskCashTotals,
  settleOrdersSchema,
  type CashSession,
} from "./cash";

const session: CashSession = {
  id: "s1",
  openedAt: 0,
  openingCashCents: 20_000_000,
  closedAt: null,
  countedCashCents: null,
  expectedCashCents: null,
  differenceCents: null,
  closeNote: null,
  openedByName: "Ana",
  closedByName: null,
};

describe("computeCashTotals", () => {
  it("matches the competition example (scenario 38)", () => {
    const totals = computeCashTotals({
      openingCashCents: 35_500_000,
      sales: [{ method: "cash", amountCents: 132_432_300 }],
      movements: [
        { method: "cash", kind: "income", amountCents: 20_870_000 },
        { method: "cash", kind: "expense", amountCents: 104_818_000 },
      ],
    });
    expect(totals.expectedCashCents).toBe(83_984_300);
    expect(cashDifference(101_770_000, totals.expectedCashCents ?? 0).cents).toBe(17_785_700);
    expect(formatCashDifference(17_785_700)).toBe("Sobrante $177.857");
  });

  it("keeps transfer sales without the tip and shows tips in their own row (scenario 17)", () => {
    const totals = computeCashTotals({
      openingCashCents: 0,
      sales: [{ method: "transfer", amountCents: 900_000, tipCents: 50_000 }],
      movements: [],
    });
    expect(totals.transfer.salesCents).toBe(900_000);
    expect(totals.transfer.tipCents).toBe(50_000);
    expect(totals.transfer.totalCents).toBe(950_000);
    expect(totals.salesCents).toBe(900_000);
  });

  it("counts split incomes, change and ignores voided movements", () => {
    const totals = computeCashTotals({
      openingCashCents: 100_000,
      sales: [{ method: "cash", amountCents: 200_000 }],
      movements: [
        { method: "cash", kind: "order_split_income", amountCents: 50_000 },
        { method: "transfer", kind: "order_split_income", amountCents: 60_000 },
        { method: "cash", kind: "courier_change_out", amountCents: 30_000 },
        { method: "cash", kind: "courier_change_back", amountCents: 10_000 },
        { method: "cash", kind: "courier_payment", amountCents: 20_000 },
        { method: "cash", kind: "expense", amountCents: 999_000, voided: true },
      ],
    });
    expect(totals.cash.totalCents).toBe(100_000 + 200_000 + 50_000 - 30_000 + 10_000 - 20_000);
    expect(totals.transfer.totalCents).toBe(60_000);
    expect(totals.consolidatedCents).toBe(totals.cash.totalCents! + 60_000);
  });

  it("masks the expected and the cash totals for a blind close", () => {
    const totals = computeCashTotals({
      openingCashCents: 100_000,
      sales: [{ method: "cash", amountCents: 200_000 }],
      movements: [{ method: "cash", kind: "income", amountCents: 50_000 }],
    });
    const masked = maskCashTotals(totals);
    expect(masked.cash.salesCents).toBe(200_000);
    expect(masked.cash.openingCents).toBeNull();
    expect(masked.cash.totalCents).toBeNull();
    expect(masked.expectedCashCents).toBeNull();
    expect(masked.consolidatedCents).toBeNull();
  });

  it("rebuilds the totals of a closed session from its snapshot", () => {
    const totals = cashTotalsFromSnapshot(
      { ...session, openingCashCents: 0, closedAt: 10, expectedCashCents: 330_000, countedCashCents: 335_000 },
      [
        {
          method: "cash",
          salesCount: 2,
          salesCents: 300_000,
          incomeCount: 1,
          incomeCents: 70_000,
          expenseCount: 1,
          expenseCents: 40_000,
          tipCount: 0,
          tipCents: 0,
        },
        {
          method: "transfer",
          salesCount: 1,
          salesCents: 100_000,
          incomeCount: 0,
          incomeCents: 0,
          expenseCount: 0,
          expenseCents: 0,
          tipCount: 1,
          tipCents: 10_000,
        },
      ],
    );
    expect(totals.expectedCashCents).toBe(330_000);
    expect(totals.cash.totalCents).toBe(330_000);
    expect(totals.transfer.totalCents).toBe(110_000);
    expect(totals.salesCents).toBe(400_000);
  });
});

describe("cash suggestions", () => {
  it("suggests the courier payment from shipping and tips minus what was paid", () => {
    expect(courierPaymentSuggestion({ shippingCents: 1_200_000, tipCents: 600_000, paidCents: 500_000 })).toBe(1_300_000);
    expect(courierPaymentSuggestion({ shippingCents: 100, tipCents: 0, paidCents: 500 })).toBe(0);
  });

  it("suggests change from the orders on the way and the change that must come back", () => {
    expect(courierChangeSuggestion([{ changeCents: 5_000 }, { changeCents: null }, { changeCents: 2_500 }])).toBe(7_500);
    expect(courierChangeBackSuggestion(10_000, 4_000)).toBe(6_000);
    expect(courierChangeBackSuggestion(10_000, 12_000)).toBe(0);
  });
});

describe("14b schemas", () => {
  it("requires the two parts of a split movement and the courier of a payment", () => {
    expect(
      createCashMovementSchema.safeParse({ kind: "income", method: "split", cashCents: 5_000, transferCents: 5_000 }).success,
    ).toBe(true);
    expect(createCashMovementSchema.safeParse({ kind: "income", method: "split", cashCents: 5_000 }).success).toBe(false);
    expect(createCashMovementSchema.safeParse({ kind: "courier_payment", method: "cash", amountCents: 5_000 }).success).toBe(
      false,
    );
    expect(
      createCashMovementSchema.safeParse({
        kind: "courier_payment",
        method: "cash",
        amountCents: 5_000,
        courierMemberId: "m1",
      }).success,
    ).toBe(true);
  });

  it("accepts counted 0, deduplicates order ids and requires at least one", () => {
    expect(closeCashSessionSchema.safeParse({ countedCashCents: 0 }).success).toBe(true);
    expect(settleOrdersSchema.parse({ orderIds: ["o1", "o1", "o2"] }).orderIds).toEqual(["o1", "o2"]);
    expect(settleOrdersSchema.safeParse({ orderIds: [] }).success).toBe(false);
  });
});

describe("movement concepts of the Arqueos report (16c)", () => {
  it("groups by kind and comment ignoring case and extra spaces, and keeps the first form", () => {
    const rows = groupCashMovements([
      { kind: "expense", comment: "  Compra   de hielo ", amountCents: 2_000, createdAt: 2 },
      { kind: "expense", comment: "COMPRA DE HIELO", amountCents: 3_000, createdAt: 3 },
      { kind: "income", comment: "compra de hielo", amountCents: 5_000, createdAt: 1 },
      { kind: "courier_payment", comment: null, amountCents: 10_000, createdAt: 4 },
    ]);
    expect(rows).toEqual([
      { kind: "income", concept: "compra de hielo", direction: "income", count: 1, amountCents: 5_000 },
      { kind: "expense", concept: "Compra   de hielo", direction: "expense", count: 2, amountCents: 5_000 },
      { kind: "courier_payment", concept: "Pago a repartidor", direction: "expense", count: 1, amountCents: 10_000 },
    ]);
  });

  it("shows the form of the oldest movement when the same comment repeats", () => {
    const rows = groupCashMovements([
      { kind: "income", comment: "Propina", amountCents: 1_000, createdAt: 5 },
      { kind: "income", comment: "propina", amountCents: 2_000, createdAt: 2 },
    ]);
    expect(rows).toEqual([{ kind: "income", concept: "propina", direction: "income", count: 2, amountCents: 3_000 }]);
  });
});
