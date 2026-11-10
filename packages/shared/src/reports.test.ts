import { describe, expect, it } from "vitest";
import { localDayRange } from "./time";
import type { HoursSlot } from "./hours";
import {
  OFF_SHIFT_ID,
  addDaysToKey,
  daysInRange,
  maskCashReportWidgets,
  percentage,
  percentChange,
  presetRange,
  previousRange,
  reportFiltersSchema,
  reportRange,
  reportRangeProblem,
  shiftOf,
  shiftsFor,
  withoutCents,
  yearBeforeRange,
} from "./reports";

/** A timestamp at `time` (HH:MM) of a `YYYY-MM-DD` day in Argentina. */
const at = (date: string, time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return localDayRange(date)[0] + (hours * 60 + minutes) * 60_000;
};

const NOW = new Date("2026-11-10T15:00:00Z"); // 12:00 in Argentina

describe("presetRange", () => {
  it("covers today, yesterday, 7 days and 30 days including today", () => {
    expect(presetRange("today", NOW)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    expect(presetRange("yesterday", NOW)).toEqual({ from: "2026-11-09", to: "2026-11-09" });
    expect(presetRange("7d", NOW)).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(presetRange("30d", NOW)).toEqual({ from: "2026-10-12", to: "2026-11-10" });
  });

  it("starts the calendar periods on their first day", () => {
    expect(presetRange("month", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(presetRange("quarter", NOW)).toEqual({ from: "2026-10-01", to: "2026-11-10" });
    expect(presetRange("semester", NOW)).toEqual({ from: "2026-07-01", to: "2026-11-10" });
    expect(presetRange("year", NOW)).toEqual({ from: "2026-01-01", to: "2026-11-10" });
  });

  it("works on the first day of a month and year", () => {
    const first = new Date("2026-01-01T12:00:00Z");
    expect(presetRange("month", first)).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(presetRange("quarter", first)).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(presetRange("semester", new Date("2026-06-30T12:00:00Z"))).toEqual({ from: "2026-01-01", to: "2026-06-30" });
    expect(presetRange("semester", new Date("2026-07-01T12:00:00Z"))).toEqual({ from: "2026-07-01", to: "2026-07-01" });
    expect(presetRange("7d", new Date("2027-01-02T12:00:00Z"))).toEqual({ from: "2026-12-27", to: "2027-01-02" });
  });
});

describe("previousRange and yearBeforeRange", () => {
  it("takes the same length immediately before", () => {
    expect(previousRange({ from: "2026-11-04", to: "2026-11-10" })).toEqual({ from: "2026-10-28", to: "2026-11-03" });
    expect(previousRange({ from: "2026-11-10", to: "2026-11-10" })).toEqual({ from: "2026-11-09", to: "2026-11-09" });
  });

  it("moves one calendar year back and clamps February 29", () => {
    expect(yearBeforeRange({ from: "2026-11-01", to: "2026-11-10" })).toEqual({ from: "2025-11-01", to: "2025-11-10" });
    expect(yearBeforeRange({ from: "2028-02-29", to: "2028-02-29" })).toEqual({ from: "2027-02-28", to: "2027-02-28" });
  });

  it("counts both ends and shifts keys across months and years", () => {
    expect(daysInRange({ from: "2026-11-04", to: "2026-11-10" })).toBe(7);
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("reportRangeProblem", () => {
  it("accepts up to a year and refuses more", () => {
    expect(reportRangeProblem({ from: "2026-01-01", to: "2026-12-31" })).toBeNull();
    expect(reportRangeProblem({ from: "2026-01-01", to: "2027-01-02" })).toBe("El rango puede ser de hasta un año");
  });

  it("refuses a reversed range", () => {
    expect(reportRangeProblem({ from: "2026-11-10", to: "2026-11-01" })).toBe(
      "La fecha de inicio no puede ser posterior a la de fin",
    );
  });
});

describe("reportRange and reportFiltersSchema", () => {
  it("uses today without the date permission, ignoring the query", () => {
    expect(reportRange({ from: "2026-01-01", to: "2026-01-31" }, false, NOW)).toEqual({
      from: "2026-11-10",
      to: "2026-11-10",
    });
    expect(reportRange({ from: "2026-01-01", to: "2026-01-31" }, true, NOW)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("parses the query and rejects bad dates and enums", () => {
    expect(reportFiltersSchema.parse({ from: "2026-11-01", to: "2026-11-10", payment: "split" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
      payment: "split",
    });
    expect(reportFiltersSchema.parse({ from: "" })).toEqual({ from: undefined });
    expect(reportFiltersSchema.safeParse({ from: "2026-02-31" }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ fulfillment: "pickup" }).success).toBe(false);
  });
});

describe("shiftsFor and shiftOf", () => {
  const slot = (weekday: HoursSlot["weekday"], opensAt: number, closesAt: number): HoursSlot => ({
    weekday,
    opensAt,
    closesAt,
    fulfillment: "all",
  });

  it("merges the same slot of several weekdays and names it by the opening hour", () => {
    expect(shiftsFor([slot(1, 690, 930), slot(2, 690, 930), slot(1, 1140, 1410)])).toEqual([
      { id: "690-930", label: "Mediodía", opensAt: 690, closesAt: 930 },
      { id: "1140-1410", label: "Noche", opensAt: 1140, closesAt: 1410 },
    ]);
  });

  it("adds the hours when two different slots share a name", () => {
    expect(shiftsFor([slot(1, 690, 930), slot(1, 720, 960)])).toEqual([
      { id: "690-930", label: "Mediodía 11:30 – 15:30", opensAt: 690, closesAt: 930 },
      { id: "720-960", label: "Mediodía 12:00 – 16:00", opensAt: 720, closesAt: 960 },
    ]);
  });

  it("assigns an order to its slot and sends the rest to off", () => {
    const hours = [slot(1, 690, 930), slot(1, 1140, 1410)];
    expect(shiftOf(at("2026-11-09", "12:00"), hours)).toBe("690-930");
    expect(shiftOf(at("2026-11-09", "16:00"), hours)).toBe(OFF_SHIFT_ID);
    expect(shiftOf(at("2026-11-09", "20:00"), hours)).toBe("1140-1410");
    expect(shiftOf(at("2026-11-10", "12:00"), hours)).toBe(OFF_SHIFT_ID);
  });

  it("keeps a slot that crosses midnight on its opening day", () => {
    const hours = [slot(1, 1140, 90)];
    expect(shiftOf(at("2026-11-09", "23:00"), hours)).toBe("1140-90");
    expect(shiftOf(at("2026-11-10", "00:30"), hours)).toBe("1140-90");
    expect(shiftOf(at("2026-11-10", "01:30"), hours)).toBe(OFF_SHIFT_ID);
  });

  it("has no shifts when the store has no hours", () => {
    expect(shiftsFor([])).toEqual([]);
    expect(shiftOf(at("2026-11-09", "12:00"), [])).toBe(OFF_SHIFT_ID);
  });
});

describe("percentages and amounts", () => {
  it("computes percentages with one decimal and compares against zero", () => {
    expect(percentage(1, 3)).toBe(33.3);
    expect(percentage(0, 0)).toBe(0);
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });

  it("removes every cents field recursively, without touching the rest", () => {
    expect(
      withoutCents({
        billed: { currentCents: 100, previousCents: 50, changePercent: 100 },
        rows: [{ method: "cash", billedCents: 100, orders: 2 }],
      }),
    ).toEqual({
      billed: { changePercent: 100 },
      rows: [{ method: "cash", orders: 2 }],
    });
  });
});

describe("maskCashReportWidgets (16c blind close)", () => {
  it("hides the expected, the counted, the difference and the cash on hand", () => {
    const masked = maskCashReportWidgets({
      open: {
        openedAt: 1,
        openedByName: "Ana",
        cashSalesCount: 2,
        cashSalesCents: 100,
        openingCashCents: 50,
        cashIncomeCents: 10,
        cashExpenseCents: 5,
        cashCents: 155,
        transferSalesCount: 1,
        transferSalesCents: 200,
        onTheStreet: { totalCents: 30 },
      },
      kpis: {
        sessions: 1,
        closed: 1,
        inProgress: 0,
        salesCents: 300,
        orders: 3,
        incomeCents: 10,
        expenseCents: 5,
        differenceCents: 0,
        expectedCents: 155,
        countedCents: 155,
        balanced: 1,
      },
      by_shift: {
        rows: [{ shift: "off", label: "Fuera de horario", sessions: 1, orders: 3, percent: 100, differenceCents: 0 }],
        total: { shift: "", label: "Total", sessions: 1, orders: 3, percent: 100, differenceCents: 0 },
      },
      sessions: [
        {
          id: "s1",
          openedAt: 1,
          closedAt: 2,
          shift: "off",
          shiftLabel: "Fuera de horario",
          openedByName: "Ana",
          closedByName: "Ana",
          orders: 3,
          expectedCashCents: 155,
          countedCashCents: 155,
          differenceCents: 0,
        },
      ],
    });

    expect(masked.open).not.toHaveProperty("cashCents");
    expect(masked.kpis).not.toHaveProperty("balanced");
    expect(masked.open?.cashSalesCents).toBe(100);
    expect(masked.kpis).not.toHaveProperty("differenceCents");
    expect(masked.kpis).not.toHaveProperty("expectedCents");
    expect(masked.by_shift?.rows[0]).not.toHaveProperty("differenceCents");
    expect(masked.sessions?.[0]).not.toHaveProperty("expectedCashCents");
    expect(masked.sessions?.[0]).not.toHaveProperty("countedCashCents");
  });
});
