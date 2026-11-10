import { z } from "zod";
import { FULFILLMENTS, PAYMENT_METHODS, type Fulfillment } from "./order";
import { ORDER_SOURCES, type OrderSource } from "./orders";
import { localWeekTime, type HoursSlot, type Weekday } from "./hours";
import { isCalendarDateKey, localDateKey } from "./time";
import type { CashMovementKind } from "./cash";

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

// ---------------------------------------------------------------------------------------------
// Facturación (change 16b)
// ---------------------------------------------------------------------------------------------

export interface BillingMethodAmountRow {
  method: "cash" | "transfer";
  orders: number;
  /** Removed without `stats.amounts`. */
  billedCents?: number;
  /** Over the billed amount, or over the orders when amounts are hidden. */
  percent: number;
}

/** "Facturación total por medio". A split order adds its part to each method, as the money is split. */
export interface BillingTotalBlock {
  /** Removed without `stats.amounts`. */
  billedCents?: number;
  orders: number;
  rows: BillingMethodAmountRow[];
}

export interface BillingOrdersRow {
  fulfillment: Fulfillment;
  orders: number;
  percent: number;
}

/** "Pedidos por modalidad". */
export interface BillingOrdersBlock {
  orders: number;
  rows: BillingOrdersRow[];
}

export interface BillingPaymentRow {
  /** `undefined` on the total row. */
  method?: "cash" | "transfer";
  orders: number;
  /** `(subtotal_cents - discount_cents) / orders`, and each amount is the method's share. All removed without `stats.amounts`. */
  ticketCents?: number;
  productsCents?: number;
  /** Only on Delivery. */
  shippingCents?: number;
  /** Only on Delivery. */
  tipsCents?: number;
  /** Sum of the amount columns, or the real total on the total row. */
  billedCents?: number;
}

/** "Delivery por medio de pago" and "Take away por medio de pago": `rows` are cash and transfer. */
export interface BillingPaymentBlock {
  rows: BillingPaymentRow[];
  total: BillingPaymentRow;
}

export interface BillingSourceRow {
  source: OrderSource;
  orders: number;
  /** Removed without `stats.amounts`. */
  ticketCents?: number;
  /** Removed without `stats.amounts`. */
  billedCents?: number;
  /** Over the billed amount, or over the orders when amounts are hidden. */
  percent: number;
}

export interface BillingWidgets {
  total?: BillingTotalBlock;
  orders_total?: BillingOrdersBlock;
  delivery?: BillingPaymentBlock;
  takeaway?: BillingPaymentBlock;
  source?: BillingSourceRow[];
}

export interface BillingReport {
  range: ReportRange;
  /** Whether the period has any sale, whatever blocks the member sees (the empty state). */
  hasActivity: boolean;
  widgets: BillingWidgets;
}

// ---------------------------------------------------------------------------------------------
// Ventas (change 16b)
// ---------------------------------------------------------------------------------------------

export interface SalesRankedProduct {
  name: string;
  units: number;
  /** List price, without the order discount nor the addons. Removed without `stats.amounts`. */
  revenueCents?: number;
}

export interface SalesTopBlock {
  byUnits: SalesRankedProduct[];
  /** Removed without `stats.amounts`. */
  byRevenue?: SalesRankedProduct[];
}

export interface SalesCategoryRow {
  /** The product's current category; `Sin categoría` for deleted products or categories. */
  category: string;
  /** Distinct products sold. */
  products: number;
  units: number;
  /** Removed without `stats.amounts`. */
  revenueCents?: number;
  /** Over the products revenue, or over the units when amounts are hidden. */
  percent: number;
}

export interface SalesCategoriesBlock {
  /** By revenue (by units without amounts). */
  rows: SalesCategoryRow[];
  total: SalesCategoryRow;
}

export interface SalesProductRow {
  productId: string | null;
  category: string;
  /** The snapshot of `order_items.name`. */
  name: string;
  units: number;
  /** Removed without `stats.amounts`. */
  revenueCents?: number;
}

export interface SalesAddonRow {
  name: string;
  /** Units above `includedQty`; the included ones are not extra. */
  units: number;
  /** Removed without `stats.amounts`. */
  revenueCents?: number;
}

export interface SalesWidgets {
  top?: SalesTopBlock;
  categories?: SalesCategoriesBlock;
  /** Every product sold in the period; the admin searches, sorts and pages them. */
  products?: SalesProductRow[];
  addons?: SalesAddonRow[];
}

export interface SalesReport {
  range: ReportRange;
  /** Whether the period has any sale, whatever blocks the member sees (the empty state). */
  hasActivity: boolean;
  widgets: SalesWidgets;
}

// ---------------------------------------------------------------------------------------------
// Repartidores (change 16c)
// ---------------------------------------------------------------------------------------------

/** An average in minutes compared against the previous period; `null` when no order has the data. */
export interface ReportAverageMetric {
  currentMinutes: number | null;
  previousMinutes: number | null;
  changePercent: number | null;
}

export interface CouriersCourierRow {
  /** `null` on the total row. */
  memberId: string | null;
  name: string;
  orders: number;
  /** Removed without `stats.amounts`. */
  shippingCents?: number;
  /** Removed without `stats.amounts`. */
  tipsCents?: number;
  averageMinutes: number | null;
  /** Cash of his orders settled into the cash drawer within the period. Removed without `stats.amounts`. */
  cashCents?: number;
}

export interface CouriersZoneRow {
  /** `null` for "Sin zona", "Tarifa fija" and the total row. */
  zoneId: string | null;
  name: string;
  orders: number;
  /** Removed without `stats.amounts`. */
  shippingCents?: number;
  /** Average `delivery_distance_m` in kilometres, one decimal. */
  distanceKm: number | null;
  averageMinutes: number | null;
}

export interface CouriersWidgets {
  orders?: ReportCountMetric;
  shipping?: ReportCentsMetric;
  tips?: ReportCentsMetric;
  time?: ReportAverageMetric;
  by_courier?: { rows: CouriersCourierRow[]; total: CouriersCourierRow };
  by_zone?: { rows: CouriersZoneRow[]; total: CouriersZoneRow };
}

export interface CouriersReport {
  range: ReportRange;
  previousRange: ReportRange;
  /** Whether the period has any delivery with an assigned courier. */
  hasActivity: boolean;
  widgets: CouriersWidgets;
}

// ---------------------------------------------------------------------------------------------
// Arqueos (change 16c)
// ---------------------------------------------------------------------------------------------

export interface CashReportOpen {
  openedAt: number;
  openedByName: string;
  cashSalesCount: number;
  /** Removed without `stats.amounts`. */
  cashSalesCents?: number;
  /** Masked without `cash.expected`. */
  openingCashCents?: number;
  /** Masked without `cash.expected`. */
  cashIncomeCents?: number;
  /** Masked without `cash.expected`. */
  cashExpenseCents?: number;
  /** Efectivo en caja now (the expected). Masked without `cash.expected`. */
  cashCents?: number;
  transferSalesCount: number;
  /** Removed without `stats.amounts`. */
  transferSalesCents?: number;
  onTheStreet: { ordersCents?: number; changeCents?: number; totalCents?: number };
}

export interface CashReportKpis {
  sessions: number;
  closed: number;
  inProgress: number;
  /** Removed without `stats.amounts`. */
  salesCents?: number;
  /** Orders charged into the sessions. */
  orders: number;
  /** Removed without `stats.amounts`. */
  incomeCents?: number;
  /** Removed without `stats.amounts`. */
  expenseCents?: number;
  /** Closed sessions only. Masked without `cash.expected`. */
  differenceCents?: number;
  /** Masked without `cash.expected`. */
  expectedCents?: number;
  /** Masked without `cash.expected`. */
  countedCents?: number;
  /** Closed sessions with difference 0. Masked without `cash.expected`: it tells whether a close was right. */
  balanced?: number;
}

export interface CashShiftRow {
  /** Shift id, or `off`; empty on the total row. */
  shift: string;
  label: string;
  sessions: number;
  orders: number;
  /** Removed without `stats.amounts`. */
  salesCents?: number;
  /** Over the sales, or over the orders when amounts are hidden. */
  percent: number;
  /** Removed without `stats.amounts`. */
  expenseCents?: number;
  /** Closed sessions only. Masked without `cash.expected`. */
  differenceCents?: number;
}

export interface CashMethodReportRow {
  /** `undefined` on the total row. */
  method?: "cash" | "transfer";
  orders: number;
  /** Removed without `stats.amounts`. */
  salesCents?: number;
  /** Over the sales, or over the orders when amounts are hidden. */
  percent: number;
  /** Removed without `stats.amounts`. */
  incomeCents?: number;
  /** Removed without `stats.amounts`. */
  expenseCents?: number;
}

export interface CashMovementReportRow {
  kind: CashMovementKind;
  /** The commentary, or the label of the kind when it is empty. */
  concept: string;
  direction: "income" | "expense";
  count: number;
  /** Removed without `stats.amounts`. */
  amountCents?: number;
}

export interface CashSessionReportRow {
  id: string;
  openedAt: number;
  closedAt: number | null;
  shift: string;
  shiftLabel: string;
  openedByName: string;
  closedByName: string | null;
  orders: number;
  /** Removed without `stats.amounts`. */
  salesCents?: number;
  /** Removed without `stats.amounts`. */
  expenseCents?: number;
  /** Masked without `cash.expected`. */
  expectedCashCents?: number;
  /** Masked without `cash.expected`. */
  countedCashCents?: number;
  /** Masked without `cash.expected`. */
  differenceCents?: number;
}

export interface CashWidgets {
  /** The open drawer now, whatever the dates say. */
  open?: CashReportOpen;
  kpis?: CashReportKpis;
  by_shift?: { rows: CashShiftRow[]; total: CashShiftRow };
  by_method?: { rows: CashMethodReportRow[]; total: CashMethodReportRow };
  movements?: CashMovementReportRow[];
  /** Newest first. */
  sessions?: CashSessionReportRow[];
}

export interface CashReport {
  range: ReportRange;
  /** Whether the period has a session, or there is an open drawer right now. */
  hasActivity: boolean;
  widgets: CashWidgets;
}

/** A copy of `value` without `keys`, for the blind-close mask. */
function without<T extends object>(value: T, ...keys: (keyof T)[]): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key as string];
  return copy as T;
}

/**
 * Blind close in Reports (change 16c): without `cash.expected` the member never sees the expected,
 * the counted, the difference or the cash on hand, whatever blocks the role has.
 */
export function maskCashReportWidgets(widgets: CashWidgets): CashWidgets {
  const { open, kpis, by_shift, sessions, ...rest } = widgets;
  return {
    ...rest,
    ...(open && { open: without(open, "openingCashCents", "cashIncomeCents", "cashExpenseCents", "cashCents") }),
    ...(kpis && { kpis: without(kpis, "expectedCents", "countedCents", "differenceCents", "balanced") }),
    ...(by_shift && {
      by_shift: {
        rows: by_shift.rows.map((row) => without(row, "differenceCents")),
        total: without(by_shift.total, "differenceCents"),
      },
    }),
    ...(sessions && {
      sessions: sessions.map((row) => without(row, "expectedCashCents", "countedCashCents", "differenceCents")),
    }),
  };
}

/** The fallback category of a product that was deleted (or whose category no longer exists). */
export const UNCATEGORIZED_LABEL = "Sin categoría";

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
