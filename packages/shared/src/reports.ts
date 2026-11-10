import { z } from "zod";
import { FULFILLMENTS, PAYMENT_METHODS } from "./order";
import { ORDER_SOURCES } from "./orders";
import { localWeekTime, type HoursSlot, type Weekday } from "./hours";
import { isCalendarDateKey, localDateKey } from "./time";

/**
 * Reports (change 16a): the query filters, the date presets and the shifts of the filters, and the
 * shapes the API answers. Pure functions only: the SQL lives in the API repository.
 */

export const MAX_REPORT_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const WEEK_MINUTES = 7 * 24 * 60;

export interface ReportRange {
  /** `YYYY-MM-DD`, in Argentina time. */
  from: string;
  to: string;
}

export const REPORT_PRESETS = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "month", label: "Este mes" },
  { id: "quarter", label: "Trimestre" },
  { id: "semester", label: "Semestre" },
  { id: "year", label: "Año" },
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number]["id"];

const pad = (value: number) => String(value).padStart(2, "0");

/** A date key moved by `days`, on the calendar (no time zone involved). */
export function addDaysToKey(key: string, days: number): string {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Days covered by `range`, both ends included. */
export function daysInRange(range: ReportRange): number {
  const [fromYear = 0, fromMonth = 1, fromDay = 1] = range.from.split("-").map(Number);
  const [toYear = 0, toMonth = 1, toDay = 1] = range.to.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / DAY_MS) + 1;
}

/** The range of a shortcut, up to today (Argentina time). "Trimestre", "Semestre" and "Año" start on the calendar. */
export function presetRange(preset: ReportPreset, now: Date): ReportRange {
  const today = localDateKey(now.getTime());
  const [year = 0, month = 1] = today.split("-").map(Number);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDaysToKey(today, -1);
      return { from: day, to: day };
    }
    case "7d":
      return { from: addDaysToKey(today, -6), to: today };
    case "30d":
      return { from: addDaysToKey(today, -29), to: today };
    case "month":
      return { from: `${year}-${pad(month)}-01`, to: today };
    case "quarter": {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${year}-${pad(firstMonth)}-01`, to: today };
    }
    case "semester": {
      const firstMonth = month <= 6 ? 1 : 7;
      return { from: `${year}-${pad(firstMonth)}-01`, to: today };
    }
    case "year":
      return { from: `${year}-01-01`, to: today };
  }
}

/** The range of the same length immediately before `range`. */
export function previousRange(range: ReportRange): ReportRange {
  const to = addDaysToKey(range.from, -1);
  return { from: addDaysToKey(to, -(daysInRange(range) - 1)), to };
}

/** The same dates one year before (`29/02` falls on `28/02` when the year is not a leap year). */
export function yearBeforeRange(range: ReportRange): ReportRange {
  const shift = (key: string) => {
    const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return `${year - 1}-${pad(month)}-${pad(Math.min(day, lastDay))}`;
  };
  return { from: shift(range.from), to: shift(range.to) };
}

/** Why a range cannot be used, or `null` when it can (at most one year, from not after to). */
export function reportRangeProblem(range: ReportRange): string | null {
  if (range.from > range.to) return "La fecha de inicio no puede ser posterior a la de fin";
  if (daysInRange(range) > MAX_REPORT_RANGE_DAYS) return "El rango puede ser de hasta un año";
  return null;
}

const optionalParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const dateKeySchema = z.string().refine(isCalendarDateKey, "Fecha inválida");

/** Query of every reports route: the range and the filters. Empty means "all" for the filters. */
export const reportFiltersSchema = z.object({
  from: optionalParam(dateKeySchema),
  to: optionalParam(dateKeySchema),
  shift: optionalParam(z.string().min(1)),
  fulfillment: optionalParam(z.enum(FULFILLMENTS)),
  payment: optionalParam(z.enum(PAYMENT_METHODS)),
  source: optionalParam(z.enum(ORDER_SOURCES)),
  courier: optionalParam(z.string().min(1)),
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/**
 * The range the service uses: the requested one, or today when the member lacks `stats.f.date`.
 * Missing ends fall back to today.
 */
export function reportRange(filters: ReportFilters, canSeeDate: boolean, now: Date): ReportRange {
  if (!canSeeDate) {
    const today = localDateKey(now.getTime());
    return { from: today, to: today };
  }
  const today = localDateKey(now.getTime());
  return { from: filters.from ?? today, to: filters.to ?? today };
}

/** Share of `part` over `total` in percent, with one decimal; `0` when `total` is 0. */
export function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

/** Variation of `current` against `previous` in percent; `null` when there is nothing to compare. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------------------------

export const OFF_SHIFT_ID = "off";

export interface ReportShift {
  /** Stable id for the URL: `<opensAt>-<closesAt>` in minutes. */
  id: string;
  label: string;
  opensAt: number;
  closesAt: number;
}

const shiftId = (opensAt: number, closesAt: number) => `${opensAt}-${closesAt}`;

const minutesLabel = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Distinct opening slots of the week: "Mediodía" (opens before 17:00) and "Noche" (from 17:00). When two
 * different slots share a name, both show their hours. A slot that crosses midnight keeps its opening day.
 */
export function shiftsFor(hours: readonly HoursSlot[]): ReportShift[] {
  const byId = new Map<string, { opensAt: number; closesAt: number }>();
  for (const slot of hours) byId.set(shiftId(slot.opensAt, slot.closesAt), { opensAt: slot.opensAt, closesAt: slot.closesAt });
  const slots = [...byId.entries()]
    .map(([id, slot]) => ({ id, ...slot }))
    .sort((a, b) => a.opensAt - b.opensAt || a.closesAt - b.closesAt);
  const base = (opensAt: number) => (opensAt < 17 * 60 ? "Mediodía" : "Noche");
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(base(slot.opensAt), (counts.get(base(slot.opensAt)) ?? 0) + 1);
  return slots.map((slot) => ({
    ...slot,
    label:
      (counts.get(base(slot.opensAt)) ?? 0) > 1
        ? `${base(slot.opensAt)} ${minutesLabel(slot.opensAt)} – ${minutesLabel(slot.closesAt)}`
        : base(slot.opensAt),
  }));
}

/** The shift an order belongs to, or `off` when it falls outside every slot. */
export function shiftOf(createdAt: number, hours: readonly HoursSlot[]): string {
  const { weekday, minutes } = localWeekTime(new Date(createdAt));
  const t = weekday * 24 * 60 + minutes;
  for (const slot of hours) {
    const start = slot.weekday * 24 * 60 + slot.opensAt;
    const length = slot.closesAt > slot.opensAt ? slot.closesAt - slot.opensAt : slot.closesAt + 24 * 60 - slot.opensAt;
    const end = start + length;
    if ((t >= start && t < end) || (t + WEEK_MINUTES >= start && t + WEEK_MINUTES < end)) {
      return shiftId(slot.opensAt, slot.closesAt);
    }
  }
  return OFF_SHIFT_ID;
}

/** The weekdays a shift id occupies, for the SQL filter (Monday-first not needed here). */
export function shiftWeekdays(shift: string, hours: readonly HoursSlot[]): Weekday[] {
  return [...new Set(hours.filter((slot) => shiftId(slot.opensAt, slot.closesAt) === shift).map((slot) => slot.weekday))];
}

// ---------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------

export interface ReportCentsMetric {
  currentCents: number;
  previousCents: number;
  changePercent: number | null;
}

export interface ReportCountMetric {
  current: number;
  previous: number;
  changePercent: number | null;
}

export interface ReportCancellations {
  count: ReportCountMetric;
  /** Without `stats.amounts` these fields are removed. */
  lostCents?: number;
  previousLostCents?: number;
  /** Over sales + cancellations, in percent. */
  ratePercent: ReportCountMetric;
}

export interface ReportPnl {
  productsCents: number;
  shippingCents: number;
  tipsCents: number;
  discountCents: number;
  billedCents: number;
}

export interface ReportPace {
  /** Weekday as `Date#getDay()` numbers it: 0 = Sunday. */
  peakDay: number | null;
  /** 0 to 23. */
  peakHour: number | null;
  ordersPerDay: number;
  newCustomers: number;
}

export interface ReportTrendPoint {
  /** `YYYY-MM-DD` of the day, in Argentina time. */
  date: string;
  billedCents: number;
  orders: number;
  /** `subtotal_cents - discount_cents`: the base of the average ticket. */
  productsCents: number;
  deliveryCents: number;
  deliveryOrders: number;
  takeawayCents: number;
  takeawayOrders: number;
}

export interface ReportTrend {
  days: ReportTrendPoint[];
  previous: ReportTrendPoint[];
  year: ReportTrendPoint[];
  /** Only when the range includes the current month; removed without `stats.amounts`. */
  projectionCents?: number;
}

export interface ReportMover {
  name: string;
  units: number;
  previousUnits: number;
  delta: number;
}

export interface ReportPaymentMethodRow {
  method: "cash" | "transfer";
  orders: number;
  /** Removed without `stats.amounts`. */
  billedCents?: number;
  /** Over the billed amount, or over the orders of the rows when amounts are hidden (the rows add up to 100). */
  percent: number;
}

export interface ReportCustomerRow {
  name: string;
  phone: string;
  orders: number;
  /** Removed without `stats.amounts`. */
  billedCents?: number;
}

export interface EvolutionWidgets {
  billed?: ReportCentsMetric;
  orders?: ReportCountMetric;
  ticket?: ReportCentsMetric;
  shipping?: ReportCentsMetric;
  discounts?: ReportCentsMetric;
  cancellations?: ReportCancellations;
  pnl?: ReportPnl;
  pace?: ReportPace;
  trend?: ReportTrend;
  /** 7 rows (Monday first) by 24 hours. */
  heatmap?: { max: number; cells: number[][] };
  movers?: { up: ReportMover[]; down: ReportMover[] };
  payment_methods?: { rows: ReportPaymentMethodRow[]; note: string };
  customers?: {
    unique: number;
    returning: number;
    ratePercent: number;
    returningBilledCents?: number;
    top: ReportCustomerRow[];
  };
}

export interface EvolutionReport {
  range: ReportRange;
  previousRange: ReportRange;
  /** Whether the period has any sale or cancellation, whatever widgets the member sees (the empty state). */
  hasActivity: boolean;
  widgets: EvolutionWidgets;
}

export interface ReportMeta {
  shifts: ReportShift[];
  couriers: { memberId: string; firstName: string; lastName: string }[];
  delivery: boolean;
  takeaway: boolean;
}

/** What is shown under "Medios de pago" (change 16a). */
export const PAYMENT_SPLIT_NOTE =
  "Los pagos divididos suman su parte a cada medio, por eso el total de pedidos puede superar al de la tarjeta";

/**
 * Removes every field ending in `Cents` (recursively), which is what the API answers to a member
 * without `stats.amounts`. Keys with cents inside a list of strings are untouched by design.
 */
export function withoutCents<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => withoutCents(entry)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!key.endsWith("Cents")) result[key] = withoutCents(entry);
    }
    return result as T;
  }
  return value;
}
