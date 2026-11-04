import { z } from "zod";
import { APP_TIME_ZONE } from "./time";

/** Weekdays as `Date#getDay()` numbers them: 0 = Sunday ... 6 = Saturday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** The order the admin lists the week in: Monday first, Sunday last. */
export const WEEKDAYS_FROM_MONDAY: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Lowercase Spanish day names, indexed by weekday. */
export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
};

/** What a slot is open for: both ways of getting the order, or only one of them. */
export const HOURS_FULFILLMENTS = ["all", "delivery", "takeaway"] as const;
export type HoursFulfillment = (typeof HOURS_FULFILLMENTS)[number];

export const HOURS_FULFILLMENT_TEXT: Readonly<Record<HoursFulfillment, string>> = {
  all: "Delivery y retiro",
  delivery: "Solo delivery",
  takeaway: "Solo retiro",
};

export const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
export const MAX_SLOTS_PER_DAY = 4;

export const HOURS_MESSAGES = {
  weekdayInvalid: "Día inválido",
  timeInvalid: "Ingresá un horario válido",
  sameTimes: "La apertura y el cierre no pueden ser iguales",
  fulfillmentInvalid: "Elegí para qué está disponible",
  tooManySlots: `Podés cargar hasta ${MAX_SLOTS_PER_DAY} franjas por día`,
  overlap: "Se superpone con otra franja",
} as const;

const minutesSchema = z
  .number(HOURS_MESSAGES.timeInvalid)
  .int(HOURS_MESSAGES.timeInvalid)
  .min(0, HOURS_MESSAGES.timeInvalid)
  .max(MINUTES_PER_DAY - 1, HOURS_MESSAGES.timeInvalid);

/**
 * One opening slot of a weekday, in minutes since midnight (Argentina time). `closesAt` lower than
 * `opensAt` crosses midnight: Monday 19:00–01:00 also covers Tuesday 00:00–01:00. Equal is refused.
 */
export const hoursSlotSchema = z
  .object({
    weekday: z
      .number(HOURS_MESSAGES.weekdayInvalid)
      .int(HOURS_MESSAGES.weekdayInvalid)
      .min(0, HOURS_MESSAGES.weekdayInvalid)
      .max(6, HOURS_MESSAGES.weekdayInvalid)
      .transform((value) => value as Weekday),
    opensAt: minutesSchema,
    closesAt: minutesSchema,
    fulfillment: z.enum(HOURS_FULFILLMENTS, HOURS_MESSAGES.fulfillmentInvalid),
  })
  .refine((slot) => slot.opensAt !== slot.closesAt, { message: HOURS_MESSAGES.sameTimes, path: ["closesAt"] });

export type HoursSlot = z.output<typeof hoursSlotSchema>;

/** Minutes from the start of the week (Sunday 00:00) to where `slot` opens and closes; `end` may pass the week. */
function weekInterval(slot: HoursSlot): { start: number; end: number } {
  const start = slot.weekday * MINUTES_PER_DAY + slot.opensAt;
  const length = slot.closesAt > slot.opensAt ? slot.closesAt - slot.opensAt : slot.closesAt + MINUTES_PER_DAY - slot.opensAt;
  return { start, end: start + length };
}

/** Whether two slots share any minute of the (cyclic) week, so Saturday's tail can hit Sunday. */
function slotsOverlap(a: HoursSlot, b: HoursSlot): boolean {
  const x = weekInterval(a);
  const y = weekInterval(b);
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some((shift) => x.start < y.end + shift && y.start + shift < x.end);
}

/**
 * Body of `PUT /api/restaurants/me/hours` and what `GET` answers: the whole week. A weekday without
 * slots is closed; slots of a day keep their array order. At most `MAX_SLOTS_PER_DAY` per day and no
 * two slots may overlap, including the part of a slot that runs past midnight into the next day.
 */
export const replaceHoursSchema = z
  .object({ slots: z.array(hoursSlotSchema).max(WEEKDAYS.length * MAX_SLOTS_PER_DAY, HOURS_MESSAGES.tooManySlots) })
  .superRefine(({ slots }, ctx) => {
    const perDay = new Map<number, number>();
    slots.forEach((slot, index) => {
      const count = (perDay.get(slot.weekday) ?? 0) + 1;
      perDay.set(slot.weekday, count);
      if (count > MAX_SLOTS_PER_DAY) {
        ctx.addIssue({ code: "custom", message: HOURS_MESSAGES.tooManySlots, path: ["slots", index] });
        return;
      }
      if (slots.slice(0, index).some((earlier) => slotsOverlap(earlier, slot))) {
        ctx.addIssue({ code: "custom", message: HOURS_MESSAGES.overlap, path: ["slots", index, "opensAt"] });
      }
    });
  });

export type ReplaceHoursInput = z.output<typeof replaceHoursSchema>;

/** What `GET`/`PUT /api/restaurants/me/hours` answer. */
export interface HoursList {
  slots: HoursSlot[];
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 1110 -> "18:30". */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "18:30" -> 1110; `null` for anything that is not a 24-hour "HH:MM". */
export function timeToMinutes(time: string): number | null {
  const match = TIME.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const WEEKDAY_BY_SHORT_NAME: Readonly<Record<string, Weekday>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const localClock = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Weekday and minutes since midnight of `date` in Argentina. */
export function localWeekTime(date: Date): { weekday: Weekday; minutes: number } {
  const parts: Record<string, string> = {};
  for (const { type, value } of localClock.formatToParts(date)) parts[type] = value;
  return {
    weekday: WEEKDAY_BY_SHORT_NAME[parts.weekday ?? "Sun"] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Slots that apply to `fulfillment` (every slot when it is omitted). */
function applicable(slots: readonly HoursSlot[], fulfillment?: "delivery" | "takeaway"): HoursSlot[] {
  return fulfillment ? slots.filter((slot) => slot.fulfillment === "all" || slot.fulfillment === fulfillment) : [...slots];
}

/**
 * Whether the store is open at `date` (Argentina time) according to `slots`, optionally only counting
 * the slots that take `fulfillment`. A slot crossing midnight keeps it open into the next day.
 */
export function isOpenAt(slots: readonly HoursSlot[], date: Date, fulfillment?: "delivery" | "takeaway"): boolean {
  const now = localWeekTime(date);
  const t = now.weekday * MINUTES_PER_DAY + now.minutes;
  return applicable(slots, fulfillment).some((slot) => {
    const { start, end } = weekInterval(slot);
    return (t >= start && t < end) || (t + MINUTES_PER_WEEK >= start && t + MINUTES_PER_WEEK < end);
  });
}

/** When the store opens next: the weekday, minutes since midnight and how many days from today (0 = today). */
export interface NextOpening {
  weekday: Weekday;
  minutes: number;
  daysAhead: number;
}

/**
 * The next slot start after `date` (Argentina time), or `null` when there are no slots. A slot that
 * opens exactly at `date` counts as now (`daysAhead` 0). Within a week, so a store open only on the
 * current weekday earlier in the day answers that weekday with `daysAhead` 7.
 */
export function nextOpening(slots: readonly HoursSlot[], date: Date, fulfillment?: "delivery" | "takeaway"): NextOpening | null {
  const now = localWeekTime(date);
  const t = now.weekday * MINUTES_PER_DAY + now.minutes;
  let best: { slot: HoursSlot; delta: number } | null = null;
  for (const slot of applicable(slots, fulfillment)) {
    // Minutes until this slot opens again: 0 when it opens right now, up to a week otherwise.
    const delta = (weekInterval(slot).start - t + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    if (!best || delta < best.delta) best = { slot, delta };
  }
  if (!best) return null;
  return {
    weekday: best.slot.weekday,
    minutes: best.slot.opensAt,
    daysAhead: Math.floor((now.minutes + best.delta) / MINUTES_PER_DAY),
  };
}

/** "hoy a las 18:00", "mañana a las 09:30" or "el martes a las 18:00". */
export function describeNextOpening(next: NextOpening): string {
  const day = next.daysAhead === 0 ? "hoy" : next.daysAhead === 1 ? "mañana" : `el ${WEEKDAY_NAMES[next.weekday]}`;
  return `${day} a las ${minutesToTime(next.minutes)}`;
}

/** Whether a store with these hours is open and takes orders at a given moment. */
export interface HoursStatus {
  /** Open now. Always `true` for a store without hours. */
  open: boolean;
  /** Takes orders now: open, or closed but accepting orders outside its hours. */
  canOrder: boolean;
  /** When it opens next; `null` while open (or without any slot for `fulfillment`). */
  next: NextOpening | null;
}

/**
 * Hours status of a store at `date`, for `fulfillment` when given. A store without slots has not set
 * hours and is treated as always open. Pausing orders (`acceptingOrders`) is a separate check that
 * takes priority over this one.
 */
export function hoursStatus(
  hours: { slots: readonly HoursSlot[]; acceptOrdersOutsideHours: boolean },
  date: Date,
  fulfillment?: "delivery" | "takeaway",
): HoursStatus {
  if (hours.slots.length === 0) return { open: true, canOrder: true, next: null };
  const open = isOpenAt(hours.slots, date, fulfillment);
  return {
    open,
    canOrder: open || hours.acceptOrdersOutsideHours,
    next: open ? null : nextOpening(hours.slots, date, fulfillment),
  };
}
