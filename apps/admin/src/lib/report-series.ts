import {
  addDaysToKey,
  previousRange,
  yearBeforeRange,
  type ReportRange,
  type ReportTrendPoint,
} from "@menucito/shared";

/** Chart controls of "Evolución de ventas" (change 16a). */
export type TrendMetric = "billed" | "orders" | "ticket";
export type TrendGroup = "day" | "week" | "month";
export type TrendView = "simple" | "compare" | "trend" | "fulfillment";
export type TrendComparison = "previous" | "year";

export interface TrendBuckets {
  labels: string[];
  current: number[];
  previous: number[];
  year: number[];
  delivery: number[];
  takeaway: number[];
  average: number[];
  total: number;
  previousTotal: number;
  /** Total of the same dates one year before ("vs año pasado"). */
  yearTotal: number;
}

interface Totals {
  billedCents: number;
  orders: number;
  productsCents: number;
}

const empty = (): Totals => ({ billedCents: 0, orders: 0, productsCents: 0 });

function bucketStart(key: string, group: TrendGroup): string {
  if (group === "day") return key;
  if (group === "week") {
    const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
    const offset = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    return addDaysToKey(key, -offset);
  }
  return `${key.slice(0, 7)}-01`;
}

function nextBucket(key: string, group: TrendGroup): string {
  if (group === "day") return addDaysToKey(key, 1);
  if (group === "week") return addDaysToKey(key, 7);
  const [year = 0, month = 1] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function bucketLabel(key: string, group: TrendGroup): string {
  const [, month = "", day = ""] = key.split("-");
  if (group === "day") return `${day}/${month}`;
  if (group === "week") return `Sem ${day}/${month}`;
  return `${month}/${key.slice(0, 4)}`;
}

function valueOf(totals: Totals, metric: TrendMetric): number {
  if (metric === "orders") return totals.orders;
  if (metric === "ticket") return totals.orders === 0 ? 0 : Math.round(totals.productsCents / totals.orders);
  return totals.billedCents;
}

function bucketStarts(range: ReportRange, group: TrendGroup): string[] {
  const buckets: string[] = [];
  let cursor = bucketStart(range.from, group);
  while (cursor <= range.to && buckets.length < 400) {
    buckets.push(cursor);
    cursor = nextBucket(cursor, group);
  }
  return buckets;
}

function seriesOf(
  points: readonly ReportTrendPoint[],
  range: ReportRange,
  group: TrendGroup,
  metric: TrendMetric,
): { labels: string[]; values: number[]; delivery: number[]; takeaway: number[] } {
  const labels = bucketStarts(range, group);
  const totals = new Map<string, Totals>(labels.map((label) => [label, empty()]));
  const delivery = new Map<string, Totals>(labels.map((label) => [label, empty()]));
  const takeaway = new Map<string, Totals>(labels.map((label) => [label, empty()]));
  for (const point of points) {
    const key = bucketStart(point.date, group);
    const bucket = totals.get(key);
    if (!bucket) continue;
    bucket.billedCents += point.billedCents;
    bucket.orders += point.orders;
    bucket.productsCents += point.productsCents;
    const deliveryBucket = delivery.get(key);
    if (deliveryBucket) {
      deliveryBucket.billedCents += point.deliveryCents;
      deliveryBucket.orders += point.deliveryOrders;
    }
    const takeawayBucket = takeaway.get(key);
    if (takeawayBucket) {
      takeawayBucket.billedCents += point.takeawayCents;
      takeawayBucket.orders += point.takeawayOrders;
    }
  }
  return {
    labels,
    values: labels.map((label) => valueOf(totals.get(label) ?? empty(), metric)),
    // A ticket per modality is not available (the API splits cents and orders only).
    delivery: labels.map((label) => valueOf(delivery.get(label) ?? empty(), metric === "ticket" ? "orders" : metric)),
    takeaway: labels.map((label) => valueOf(takeaway.get(label) ?? empty(), metric === "ticket" ? "orders" : metric)),
  };
}

const aligned = (values: number[], length: number): number[] =>
  Array.from({ length }, (_, index) => values[index] ?? 0);

/** Total of a metric over a list of daily points (the ticket is the period ticket, not a sum of tickets). */
function totalOf(points: readonly ReportTrendPoint[], metric: TrendMetric): number {
  const totals = points.reduce(
    (sum, point) => ({
      billedCents: sum.billedCents + point.billedCents,
      orders: sum.orders + point.orders,
      productsCents: sum.productsCents + point.productsCents,
    }),
    empty(),
  );
  return valueOf(totals, metric);
}

/** Daily points grouped by day, week (Monday first) or month, with the previous and last-year series aligned. */
export function buildTrendSeries(
  data: { days: readonly ReportTrendPoint[]; previous: readonly ReportTrendPoint[]; year: readonly ReportTrendPoint[] },
  range: ReportRange,
  group: TrendGroup,
  metric: TrendMetric,
): TrendBuckets {
  const current = seriesOf(data.days, range, group, metric);
  const previous = seriesOf(data.previous, previousRange(range), group, metric);
  const previousAligned = aligned(previous.values, current.values.length);
  const currentValues = aligned(current.values, current.values.length);
  const length = current.labels.length;
  const average = currentValues.map((_, index) => {
    const window = currentValues.slice(Math.max(0, index - 6), index + 1);
    return Math.round(window.reduce((sum, value) => sum + value, 0) / window.length);
  });

  return {
    labels: current.labels.map((label) => bucketLabel(label, group)),
    current: currentValues,
    // The previous series is grouped over its own range; days are comparable one to one.
    previous: previousAligned,
    year: aligned(seriesOf(data.year, yearBeforeRange(range), group, metric).values, length),
    delivery: aligned(current.delivery, length),
    takeaway: aligned(current.takeaway, length),
    average,
    total: totalOf(data.days, metric),
    previousTotal: totalOf(data.previous, metric),
    yearTotal: totalOf(data.year, metric),
  };
}
