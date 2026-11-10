import type { HoursSlot } from "@menucito/shared";
import { OFF_SHIFT_ID, type ReportFilters } from "@menucito/shared";

/**
 * Aggregated SQL of the Reports section. Every method receives an explicit range (the service converts
 * the Argentina dates to UTC milliseconds) and the filters the member may use. No row of an order
 * reaches the service: only sums and counts.
 */

export interface ReportScope {
  restaurantId: string;
  /** Inclusive. */
  fromMs: number;
  /** Exclusive. */
  toMs: number;
  filters: ReportFilters;
  hours: readonly HoursSlot[];
}

export interface SalesSummaryRow {
  orders: number;
  billedCents: number;
  /** `subtotal_cents` (products and addons, before the discount). */
  subtotalCents: number;
  /** `subtotal_cents - discount_cents`: the base of the average ticket. */
  productsCents: number;
  shippingCents: number;
  tipsCents: number;
  discountCents: number;
}

export interface DailySeriesRow {
  date: string;
  fulfillment: string;
  orders: number;
  billedCents: number;
  productsCents: number;
}

export interface HourGridRow {
  /** `Date#getDay()`: 0 = Sunday. */
  weekday: number;
  hour: number;
  orders: number;
}

export interface ItemUnitsRow {
  name: string;
  units: number;
}

export interface PaymentTotalsRow {
  method: string;
  orders: number;
  cashCents: number;
  transferCents: number;
}

export interface CustomerReportRow {
  customerId: string;
  name: string;
  phone: string;
  orders: number;
  billedCents: number;
  /** Sales of the same customer before the range. */
  earlier: number;
}

export interface ReportsRepository {
  salesSummary(scope: ReportScope): Promise<SalesSummaryRow>;
  cancellationsSummary(scope: ReportScope): Promise<{ count: number; totalCents: number }>;
  dailySeries(scope: ReportScope): Promise<DailySeriesRow[]>;
  hourGrid(scope: ReportScope): Promise<HourGridRow[]>;
  itemUnits(scope: ReportScope): Promise<ItemUnitsRow[]>;
  paymentTotals(scope: ReportScope): Promise<PaymentTotalsRow[]>;
  customers(scope: ReportScope): Promise<CustomerReportRow[]>;
  newCustomers(restaurantId: string, fromMs: number, toMs: number): Promise<number>;
}

const LOCAL_DAY = "CAST((o.created_at - 10800000) / 86400000 AS INTEGER)";
const WEEKDAY = `((${LOCAL_DAY} + 4) % 7)`;
const MINUTE_OF_DAY = "((CAST(o.created_at / 60000 AS INTEGER) - 180) % 1440 + 1440) % 1440";
const HOUR_OF_DAY = "((CAST(o.created_at / 3600000 AS INTEGER) - 3) % 24 + 24) % 24";

const slotId = (slot: HoursSlot) => `${slot.opensAt}-${slot.closesAt}`;

/** SQL that keeps the orders of `shift`; a slot that crosses midnight belongs to the day it opens. */
export function shiftCondition(shift: string, hours: readonly HoursSlot[]): string {
  const slotCondition = (filter: (slot: HoursSlot) => boolean) =>
    hours
      .filter(filter)
      .map((slot) => {
        if (slot.closesAt > slot.opensAt) {
          return `(${WEEKDAY} = ${slot.weekday} AND (${MINUTE_OF_DAY}) >= ${slot.opensAt} AND (${MINUTE_OF_DAY}) < ${slot.closesAt})`;
        }
        return `((${WEEKDAY} = ${slot.weekday} AND (${MINUTE_OF_DAY}) >= ${slot.opensAt}) OR (${WEEKDAY} = ${(slot.weekday + 1) % 7} AND (${MINUTE_OF_DAY}) < ${slot.closesAt}))`;
      });

  if (shift === OFF_SHIFT_ID) {
    const inside = slotCondition(() => true);
    return inside.length === 0 ? "1 = 1" : `NOT (${inside.join(" OR ")})`;
  }
  const slots = slotCondition((slot) => slotId(slot) === shift);
  if (slots.length === 0) return "1 = 0";
  return `(${slots.join(" OR ")})`;
}

interface Where {
  sql: string;
  params: (string | number)[];
}

/** The common `WHERE` of a sales (or cancelled) query, with the filters the service passed. */
export function reportWhere(scope: ReportScope, kind: "sales" | "cancelled"): Where {
  const clauses = ["o.restaurant_id = ?", "o.created_at >= ?", "o.created_at < ?"];
  const params: (string | number)[] = [scope.restaurantId, scope.fromMs, scope.toMs];
  if (kind === "sales") clauses.push("o.status = 'delivered'", "o.payment_status = 'paid'");
  else clauses.push("o.status = 'cancelled'");

  const { filters } = scope;
  if (filters.fulfillment) {
    clauses.push("o.fulfillment = ?");
    params.push(filters.fulfillment);
  }
  if (filters.source) {
    clauses.push("o.source = ?");
    params.push(filters.source);
  }
  if (filters.courier) {
    clauses.push("o.courier_member_id = ?");
    params.push(filters.courier);
  }
  if (filters.payment === "cash") clauses.push("o.payment_method IN ('cash', 'split')");
  else if (filters.payment === "transfer") clauses.push("o.payment_method IN ('transfer', 'split')");
  else if (filters.payment === "split") clauses.push("o.payment_method = 'split'");
  if (filters.shift) clauses.push(shiftCondition(filters.shift, scope.hours));

  return { sql: clauses.join(" AND "), params };
}

const number = (value: unknown): number => Number(value ?? 0);

/** The cash part of an order (all of it for cash, the declared part for split, nothing for transfer). */
const SPLIT_CASH = "MIN(o.total_cents, MAX(COALESCE(o.split_cash_cents, 0), 0))";

/**
 * SQL for an amount column under the payment filter: with `cash` (or `transfer`) a split order only
 * adds the share of that method, in proportion to its total (spec 16a: "solo su parte en efectivo").
 */
export function amountOf(column: string, scope: Pick<ReportScope, "filters">): string {
  const payment = scope.filters.payment;
  if (payment !== "cash" && payment !== "transfer") return column;
  const part = payment === "cash" ? SPLIT_CASH : `(o.total_cents - ${SPLIT_CASH})`;
  return `(CASE WHEN o.payment_method = 'split' AND o.total_cents > 0
            THEN CAST(ROUND(${column} * ${part} * 1.0 / o.total_cents) AS INTEGER)
            ELSE ${column} END)`;
}

export function createReportsRepository(d1: D1Database): ReportsRepository {
  async function row<T>(sql: string, params: (string | number)[]): Promise<T | null> {
    return d1.prepare(sql).bind(...params).first<T>();
  }

  async function all<T>(sql: string, params: (string | number)[]): Promise<T[]> {
    return (await d1.prepare(sql).bind(...params).all<T>()).results;
  }

  return {
    async salesSummary(scope) {
      const where = reportWhere(scope, "sales");
      const found = await row<{
        orders: number;
        billedCents: number;
        subtotalCents: number;
        productsCents: number;
        shippingCents: number;
        tipsCents: number;
        discountCents: number;
      }>(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(${amountOf("o.total_cents", scope)}), 0) AS billedCents,
                COALESCE(SUM(${amountOf("o.subtotal_cents", scope)}), 0) AS subtotalCents,
                COALESCE(SUM(${amountOf("(o.subtotal_cents - o.discount_cents)", scope)}), 0) AS productsCents,
                COALESCE(SUM(${amountOf("o.shipping_cents", scope)}), 0) AS shippingCents,
                COALESCE(SUM(${amountOf("o.tip_cents", scope)}), 0) AS tipsCents,
                COALESCE(SUM(${amountOf("o.discount_cents", scope)}), 0) AS discountCents
           FROM orders o
          WHERE ${where.sql}`,
        where.params,
      );
      return {
        orders: number(found?.orders),
        billedCents: number(found?.billedCents),
        subtotalCents: number(found?.subtotalCents),
        productsCents: number(found?.productsCents),
        shippingCents: number(found?.shippingCents),
        tipsCents: number(found?.tipsCents),
        discountCents: number(found?.discountCents),
      };
    },

    async cancellationsSummary(scope) {
      const where = reportWhere(scope, "cancelled");
      const found = await row<{ count: number; totalCents: number }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(${amountOf("o.total_cents", scope)}), 0) AS totalCents
           FROM orders o
          WHERE ${where.sql}`,
        where.params,
      );
      return { count: number(found?.count), totalCents: number(found?.totalCents) };
    },

    async dailySeries(scope) {
      const where = reportWhere(scope, "sales");
      return all<DailySeriesRow>(
        `SELECT date(o.created_at / 1000, 'unixepoch', '-3 hours') AS date,
                o.fulfillment AS fulfillment,
                COUNT(*) AS orders,
                COALESCE(SUM(${amountOf("o.total_cents", scope)}), 0) AS billedCents,
                COALESCE(SUM(${amountOf("(o.subtotal_cents - o.discount_cents)", scope)}), 0) AS productsCents
           FROM orders o
          WHERE ${where.sql}
          GROUP BY date, o.fulfillment
          ORDER BY date`,
        where.params,
      );
    },

    async hourGrid(scope) {
      const where = reportWhere(scope, "sales");
      return all<HourGridRow>(
        `SELECT ${WEEKDAY} AS weekday, ${HOUR_OF_DAY} AS hour, COUNT(*) AS orders
           FROM orders o
          WHERE ${where.sql}
          GROUP BY weekday, hour`,
        where.params,
      );
    },

    async itemUnits(scope) {
      const where = reportWhere(scope, "sales");
      return all<ItemUnitsRow>(
        `SELECT i.name AS name, COALESCE(SUM(i.quantity), 0) AS units
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
          WHERE ${where.sql}
          GROUP BY i.name`,
        where.params,
      );
    },

    async paymentTotals(scope) {
      const where = reportWhere(scope, "sales");
      return all<PaymentTotalsRow>(
        `SELECT o.payment_method AS method,
                COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.payment_method = 'cash' THEN o.total_cents
                                  WHEN o.payment_method = 'split'
                                    THEN ${SPLIT_CASH}
                                  ELSE 0 END), 0) AS cashCents,
                COALESCE(SUM(CASE WHEN o.payment_method = 'transfer' THEN o.total_cents
                                  WHEN o.payment_method = 'split'
                                    THEN o.total_cents - ${SPLIT_CASH}
                                  ELSE 0 END), 0) AS transferCents
           FROM orders o
          WHERE ${where.sql}
          GROUP BY o.payment_method`,
        where.params,
      );
    },

    async customers(scope) {
      const where = reportWhere(scope, "sales");
      // The correlated subquery appears first in the SELECT, so its `?` is bound before the WHERE ones.
      return all<CustomerReportRow>(
        `SELECT (SELECT COUNT(*) FROM orders p
                  WHERE p.restaurant_id = o.restaurant_id AND p.customer_id = o.customer_id
                    AND p.status = 'delivered' AND p.payment_status = 'paid' AND p.created_at < ?) AS earlier,
                o.customer_id AS customerId,
                c.name AS name,
                c.phone AS phone,
                COUNT(*) AS orders,
                COALESCE(SUM(${amountOf("o.total_cents", scope)}), 0) AS billedCents
           FROM orders o
           JOIN customers c ON c.id = o.customer_id
          WHERE ${where.sql} AND o.customer_id IS NOT NULL
          GROUP BY o.customer_id, c.name, c.phone`,
        [scope.fromMs, ...where.params],
      );
    },

    async newCustomers(restaurantId, fromMs, toMs) {
      const found = await d1
        .prepare(
          `SELECT COUNT(*) AS count FROM customers
            WHERE restaurant_id = ? AND first_order_at >= ? AND first_order_at < ?`,
        )
        .bind(restaurantId, fromMs, toMs)
        .first<{ count: number }>();
      return number(found?.count);
    },
  };
}
