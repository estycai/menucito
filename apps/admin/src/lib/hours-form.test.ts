import { describe, expect, it } from "vitest";
import { HOURS_MESSAGES, type HoursSlot } from "@menucito/shared";
import {
  DEFAULT_SLOT,
  addSlot,
  canAddSlot,
  checkWeek,
  copyDay,
  emptyWeek,
  hoursBanner,
  removeSlot,
  setDayClosed,
  updateSlot,
  weekFromSlots,
  weekSignature,
} from "./hours-form";

function keys() {
  let n = 0;
  return () => `k${n++}`;
}

// 2026-11-02 is a Monday; Argentina is UTC-3.
const at = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

const dinner: HoursSlot = { weekday: 1, opensAt: 19 * 60, closesAt: 60, fulfillment: "all" };
const lunch: HoursSlot = { weekday: 1, opensAt: 12 * 60, closesAt: 15 * 60, fulfillment: "takeaway" };

describe("weekFromSlots", () => {
  it("groups the slots by weekday as HH:MM, keeping their order", () => {
    const week = weekFromSlots([lunch, dinner], keys());
    expect(week[1]).toEqual([
      { key: "k0", opens: "12:00", closes: "15:00", fulfillment: "takeaway" },
      { key: "k1", opens: "19:00", closes: "01:00", fulfillment: "all" },
    ]);
    expect(week[0]).toEqual([]);
  });
});

describe("day editing", () => {
  it("opens a closed day with 18:00–23:00 for delivery and takeaway, and closes it again", () => {
    const opened = setDayClosed(emptyWeek(), 3, false, keys());
    expect(opened[3]).toEqual([{ key: "k0", ...DEFAULT_SLOT }]);
    expect(setDayClosed(opened, 3, true, keys())[3]).toEqual([]);
  });

  it("adds a slot after the last one and stops at four", () => {
    const newKey = keys();
    let week = addSlot(emptyWeek(), 2, newKey);
    expect(week[2]).toEqual([{ key: "k0", ...DEFAULT_SLOT }]);
    week = addSlot(week, 2, newKey);
    expect(week[2][1]).toEqual({ key: "k1", opens: "23:00", closes: "02:00", fulfillment: "all" });
    week = addSlot(addSlot(week, 2, newKey), 2, newKey);
    expect(week[2]).toHaveLength(4);
    expect(canAddSlot(week, 2)).toBe(false);
    expect(addSlot(week, 2, newKey)).toBe(week);
  });

  it("updates and removes one slot", () => {
    let week = weekFromSlots([lunch, dinner], keys());
    week = updateSlot(week, 1, "k0", { closes: "16:00", fulfillment: "all" });
    expect(week[1][0]).toEqual({ key: "k0", opens: "12:00", closes: "16:00", fulfillment: "all" });
    expect(removeSlot(week, 1, "k0")[1].map((slot) => slot.key)).toEqual(["k1"]);
  });

  it("copies a day to others with fresh keys, closing the targets when the source is closed", () => {
    const newKey = keys();
    const week = weekFromSlots([lunch, dinner], newKey);
    const copied = copyDay(week, 1, [2, 5], newKey);
    expect(copied[2].map(({ opens, closes }) => [opens, closes])).toEqual([
      ["12:00", "15:00"],
      ["19:00", "01:00"],
    ]);
    expect(new Set([...copied[1], ...copied[2], ...copied[5]].map((slot) => slot.key)).size).toBe(6);
    expect(copyDay(copied, 0, [2], newKey)[2]).toEqual([]);
  });

  it("tells unsaved changes apart by content, not by keys", () => {
    const a = weekFromSlots([lunch], keys());
    const b = weekFromSlots([lunch], () => "other");
    expect(weekSignature(a)).toBe(weekSignature(b));
    expect(weekSignature(updateSlot(a, 1, "k0", { opens: "11:00" }))).not.toBe(weekSignature(b));
  });
});

describe("checkWeek", () => {
  it("builds the API input Monday first", () => {
    const week = weekFromSlots([{ ...lunch, weekday: 0 }, dinner], keys());
    expect(checkWeek(week)).toEqual({
      input: { slots: [dinner, { ...lunch, weekday: 0 }] },
      errors: {},
    });
  });

  it("flags an empty time on its slot", () => {
    const week = updateSlot(weekFromSlots([lunch], keys()), 1, "k0", { closes: "" });
    expect(checkWeek(week)).toEqual({ input: null, errors: { k0: { closes: HOURS_MESSAGES.timeInvalid } } });
  });

  it("maps equal times and overlaps (also across midnight) back to the slot", () => {
    const same = updateSlot(weekFromSlots([lunch], keys()), 1, "k0", { closes: "12:00" });
    expect(checkWeek(same).errors).toEqual({ k0: { closes: HOURS_MESSAGES.sameTimes } });

    const tail = weekFromSlots([dinner, { weekday: 2, opensAt: 30, closesAt: 120, fulfillment: "all" }], keys());
    expect(checkWeek(tail)).toEqual({ input: null, errors: { k1: { opens: HOURS_MESSAGES.overlap } } });
  });

  it("accepts a closed week", () => {
    expect(checkWeek(emptyWeek())).toEqual({ input: { slots: [] }, errors: {} });
  });
});

describe("hoursBanner", () => {
  it("puts the paused reception first", () => {
    expect(hoursBanner([dinner], false, at("2026-11-02T20:00:00"))).toMatchObject({ tone: "warning", pausedLink: true });
  });

  it("says a store without hours is always open", () => {
    expect(hoursBanner([], true, at("2026-11-02T20:00:00")).text).toBe("Todavía no cargaste horarios: tu local figura siempre abierto.");
  });

  it("says open or closed with the next opening", () => {
    expect(hoursBanner([dinner], true, at("2026-11-03T00:30:00")).text).toBe("Según tus horarios, ahora estás abierto.");
    expect(hoursBanner([dinner], true, at("2026-11-02T10:00:00")).text).toBe(
      "Según tus horarios, ahora estás cerrado. Abre hoy a las 19:00.",
    );
    expect(hoursBanner([dinner, { ...lunch, weekday: 4 }], true, at("2026-11-03T10:00:00")).text).toBe(
      "Según tus horarios, ahora estás cerrado. Abre el jueves a las 12:00.",
    );
  });
});
