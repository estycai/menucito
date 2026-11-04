import { describe, expect, it } from "vitest";
import {
  HOURS_MESSAGES,
  type HoursSlot,
  describeNextOpening,
  hoursStatus,
  isOpenAt,
  localWeekTime,
  minutesToTime,
  nextOpening,
  replaceHoursSchema,
  timeToMinutes,
} from "./hours";

// 2026-11-02 is a Monday. Argentina is UTC-3 all year, so the offsets below are its local times.
const at = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

const slot = (weekday: number, opens: string, closes: string, fulfillment: HoursSlot["fulfillment"] = "all"): HoursSlot => ({
  weekday: weekday as HoursSlot["weekday"],
  opensAt: timeToMinutes(opens) ?? -1,
  closesAt: timeToMinutes(closes) ?? -1,
  fulfillment,
});

const messages = (input: unknown) => {
  const result = replaceHoursSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
};

describe("minutesToTime / timeToMinutes", () => {
  it("round-trips the edges of the day", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(1110)).toBe("18:30");
    expect(minutesToTime(1439)).toBe("23:59");
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("18:30")).toBe(1110);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("refuses anything that is not HH:MM in 24 hours", () => {
    for (const bad of ["", "24:00", "7:00", "18:60", "18:30:00", "aa:bb"]) expect(timeToMinutes(bad)).toBeNull();
  });
});

describe("localWeekTime", () => {
  it("reads the weekday and time in Argentina, not UTC", () => {
    // 02:30 UTC on Tuesday is still Monday 23:30 in Buenos Aires.
    expect(localWeekTime(new Date("2026-11-03T02:30:00Z"))).toEqual({ weekday: 1, minutes: 23 * 60 + 30 });
  });
});

describe("replaceHoursSchema", () => {
  it("accepts an empty week (always closed) and two slots on one day", () => {
    expect(messages({ slots: [] })).toEqual([]);
    expect(messages({ slots: [slot(1, "12:00", "15:00"), slot(1, "19:00", "01:00")] })).toEqual([]);
  });

  it("refuses a slot inside the previous day's midnight tail", () => {
    expect(messages({ slots: [slot(1, "12:00", "15:00"), slot(1, "19:00", "01:00"), slot(2, "00:30", "01:00", "delivery")] })).toEqual([
      { path: ["slots", 2, "opensAt"], message: HOURS_MESSAGES.overlap },
    ]);
  });

  it("refuses equal opening and closing times", () => {
    expect(messages({ slots: [slot(3, "18:00", "18:00")] })).toEqual([{ path: ["slots", 0, "closesAt"], message: HOURS_MESSAGES.sameTimes }]);
  });

  it("refuses minutes out of the day, an unknown weekday and an unknown fulfillment", () => {
    expect(messages({ slots: [{ weekday: 1, opensAt: 1440, closesAt: 60, fulfillment: "all" }] })[0]?.message).toBe(HOURS_MESSAGES.timeInvalid);
    expect(messages({ slots: [{ weekday: 7, opensAt: 0, closesAt: 60, fulfillment: "all" }] })[0]?.message).toBe(HOURS_MESSAGES.weekdayInvalid);
    expect(messages({ slots: [{ weekday: 1, opensAt: 0, closesAt: 60, fulfillment: "dine_in" }] })[0]?.message).toBe(
      HOURS_MESSAGES.fulfillmentInvalid,
    );
  });

  it("refuses overlapping slots of the same day but lets them touch", () => {
    expect(messages({ slots: [slot(1, "12:00", "16:00"), slot(1, "15:00", "18:00")] })).toEqual([
      { path: ["slots", 1, "opensAt"], message: HOURS_MESSAGES.overlap },
    ]);
    expect(messages({ slots: [slot(1, "12:00", "16:00"), slot(1, "16:00", "18:00")] })).toEqual([]);
  });

  it("refuses a midnight tail that runs into the next day's first slot, also from Saturday into Sunday", () => {
    expect(messages({ slots: [slot(6, "20:00", "02:00"), slot(0, "01:00", "05:00")] })).toEqual([
      { path: ["slots", 1, "opensAt"], message: HOURS_MESSAGES.overlap },
    ]);
    expect(messages({ slots: [slot(6, "20:00", "02:00"), slot(0, "02:00", "05:00")] })).toEqual([]);
  });

  it("allows up to four slots per day", () => {
    const four = [slot(5, "08:00", "09:00"), slot(5, "10:00", "11:00"), slot(5, "12:00", "13:00"), slot(5, "14:00", "15:00")];
    expect(messages({ slots: four })).toEqual([]);
    expect(messages({ slots: [...four, slot(5, "16:00", "17:00")] })).toEqual([{ path: ["slots", 4], message: HOURS_MESSAGES.tooManySlots }]);
  });
});

describe("isOpenAt", () => {
  const week = [slot(1, "19:00", "01:00"), slot(3, "12:00", "15:00", "takeaway"), slot(6, "20:00", "02:00")];

  it("is open inside a slot and closed outside it", () => {
    expect(isOpenAt(week, at("2026-11-02T20:00:00"))).toBe(true);
    expect(isOpenAt(week, at("2026-11-02T18:59:00"))).toBe(false);
    expect(isOpenAt(week, at("2026-11-02T19:00:00"))).toBe(true);
  });

  it("keeps Monday 19:00–01:00 open on Tuesday at 00:30 and closes it at 01:00", () => {
    expect(isOpenAt(week, at("2026-11-03T00:30:00"))).toBe(true);
    expect(isOpenAt(week, at("2026-11-03T01:00:00"))).toBe(false);
  });

  it("wraps Saturday's tail into Sunday", () => {
    expect(isOpenAt(week, at("2026-11-08T01:30:00"))).toBe(true);
    expect(isOpenAt(week, at("2026-11-08T02:00:00"))).toBe(false);
  });

  it("counts only the slots that take the given fulfillment", () => {
    const wednesday = at("2026-11-04T13:00:00");
    expect(isOpenAt(week, wednesday)).toBe(true);
    expect(isOpenAt(week, wednesday, "takeaway")).toBe(true);
    expect(isOpenAt(week, wednesday, "delivery")).toBe(false);
    expect(isOpenAt(week, at("2026-11-02T20:00:00"), "delivery")).toBe(true);
  });

  it("is always closed without slots", () => {
    expect(isOpenAt([], at("2026-11-02T20:00:00"))).toBe(false);
  });
});

describe("nextOpening", () => {
  const week = [slot(1, "19:00", "01:00"), slot(2, "12:00", "15:00"), slot(2, "18:00", "23:00")];

  it("answers later today", () => {
    expect(nextOpening(week, at("2026-11-02T10:00:00"))).toEqual({ weekday: 1, minutes: 19 * 60, daysAhead: 0 });
    expect(nextOpening(week, at("2026-11-03T16:00:00"))).toEqual({ weekday: 2, minutes: 18 * 60, daysAhead: 0 });
  });

  it("answers a later day, counting the days ahead", () => {
    expect(nextOpening(week, at("2026-11-02T20:00:00"))).toEqual({ weekday: 2, minutes: 12 * 60, daysAhead: 1 });
    expect(nextOpening(week, at("2026-11-04T09:00:00"))).toEqual({ weekday: 1, minutes: 19 * 60, daysAhead: 5 });
  });

  it("treats a slot opening right now as today", () => {
    expect(nextOpening(week, at("2026-11-02T19:00:00"))).toEqual({ weekday: 1, minutes: 19 * 60, daysAhead: 0 });
  });

  it("answers next week for a single slot already past today", () => {
    expect(nextOpening([slot(1, "09:00", "10:00")], at("2026-11-02T11:00:00"))).toEqual({ weekday: 1, minutes: 9 * 60, daysAhead: 7 });
  });

  it("filters by fulfillment and answers null without slots", () => {
    expect(nextOpening([slot(1, "09:00", "10:00", "takeaway")], at("2026-11-02T08:00:00"), "delivery")).toBeNull();
    expect(nextOpening([], at("2026-11-02T08:00:00"))).toBeNull();
  });
});

describe("describeNextOpening", () => {
  it("says today, tomorrow or the weekday", () => {
    expect(describeNextOpening({ weekday: 1, minutes: 18 * 60, daysAhead: 0 })).toBe("hoy a las 18:00");
    expect(describeNextOpening({ weekday: 2, minutes: 9 * 60 + 30, daysAhead: 1 })).toBe("mañana a las 09:30");
    expect(describeNextOpening({ weekday: 3, minutes: 12 * 60, daysAhead: 2 })).toBe("el miércoles a las 12:00");
  });
});

describe("hoursStatus", () => {
  const slots = [slot(1, "19:00", "23:00"), slot(2, "12:00", "15:00", "takeaway")];
  const monday = at("2026-11-02T10:00:00");

  it("treats a store without hours as always open", () => {
    expect(hoursStatus({ slots: [], acceptOrdersOutsideHours: false }, monday)).toEqual({ open: true, canOrder: true, next: null });
  });

  it("blocks orders while closed unless the store accepts them outside its hours", () => {
    const next = { weekday: 1, minutes: 19 * 60, daysAhead: 0 };
    expect(hoursStatus({ slots, acceptOrdersOutsideHours: false }, monday)).toEqual({ open: false, canOrder: false, next });
    expect(hoursStatus({ slots, acceptOrdersOutsideHours: true }, monday)).toEqual({ open: false, canOrder: true, next });
  });

  it("is open inside a slot for its fulfillment only", () => {
    const tuesday = at("2026-11-03T13:00:00");
    expect(hoursStatus({ slots, acceptOrdersOutsideHours: false }, tuesday, "takeaway").canOrder).toBe(true);
    expect(hoursStatus({ slots, acceptOrdersOutsideHours: false }, tuesday, "delivery")).toEqual({
      open: false,
      canOrder: false,
      next: { weekday: 1, minutes: 19 * 60, daysAhead: 6 },
    });
  });
});
