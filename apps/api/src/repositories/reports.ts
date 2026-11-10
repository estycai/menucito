import type { Fulfillment, HoursSlot, OrderSource } from "@menucito/shared";
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

export interface BillingTotalsRow {
  fulfillment: Fulfillment;
  orders: number;
  productsCents: number;
  shippingCents: number;
  tipsCents: number;
  cashOrders: number;
  cashProductsCents: number;
  cashShippingCents: number;
  cashTipsCents: number;
  transferOrders: number;
  transferProductsCents: number;
  transferShippingCents: number;
  transferTipsCents: number;
}

export interface SourceTotalsRow {
  source: OrderSource;
  orders: number;
  productsCents: number;
  billedCents: number;
}

export interface ProductSalesRow {
  productId: string | null;
  categoryName: string | null;
  name: string;
  units: number;
  revenueCents: number;
}

export interface AddonSalesRow {
  name: string;
  units: number;
  revenueCents: number;
}

export interface CourierSummaryRow {
  orders: number;
  shippingCents: number;
  tipsCents: number;
  averageMinutes: number | null;
  averageDistanceM: number | null;
}

export interface CourierTotalsRow {
  memberId: string;
  firstName: string;
  lastName: string;
  orders: number;
  shippingCents: number;
  tipsCents: number;
  averageMinutes: number | null;
  cashCents: number;
}

export interface ZoneTotalsRow {
  zoneId: string | null;
  zoneName: string | null;
  orders: number;
  shippingCents: number;
  averageDistanceM: number | null;
  averageMinutes: number | null;
}

export interface CourierOptionRow {
  memberId: string;
  firstName: string;
  lastName: string;
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
  billingTotals(scope: ReportScope): Promise<BillingTotalsRow[]>;
  sourceTotals(scope: ReportScope): Promise<SourceTotalsRow[]>;
  productSales(scope: ReportScope): Promise<ProductSalesRow[]>;
  addonSales(scope: ReportScope): Promise<AddonSalesRow[]>;
  courierSummary(scope: ReportScope): Promise<CourierSummaryRow>;
  courierTotals(scope: ReportScope, settledFromMs: number, settledToMs: number): Promise<CourierTotalsRow[]>;
  zoneTotals(scope: ReportScope): Promise<ZoneTotalsRow[]>;
  courierOptions(restaurantId: string, sinceMs: number): Promise<CourierOptionRow[]>;
  deliveryMode(restaurantId: string): Promise<"flat" | "zones">;
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
const nullableNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** The cash part of an order (all of it for cash, the declared part for split, nothing for transfer). */
const SPLIT_CASH = "MIN(o.total_cents, MAX(COALESCE(o.split_cash_cents, 0), 0))";

/** Delivery orders with a courier: the universe of the Repartidores tab (change 16c). */
const DELIVERY_WITH_COURIER = "o.fulfillment = 'delivery' AND o.courier_member_id IS NOT NULL";

/** Minutes between Enviado and Entregado; `NULL` on the orders of before migration 0012. */
const DELIVERY_MINUTES = `CASE WHEN o.sent_at IS NOT NULL AND o.delivered_at IS NOT NULL AND o.delivered_at >= o.sent_at
  THEN (o.delivered_at - o.sent_at) / 60000.0 END`;

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

/** Cash share of shipping or tips for a split order, rounded down (change 16b). */
const SPLIT_CASH_SHARE = (column: string) =>
  `(CASE WHEN o.total_cents > 0 THEN CAST(${column} * ${SPLIT_CASH} * 1.0 / o.total_cents AS INTEGER) ELSE 0 END)`;

type BillingColumn = "products" | "shipping" | "tips";

const BILLING_COLUMNS: Record<BillingColumn, string> = {
  products: "(o.subtotal_cents - o.discount_cents)",
  shipping: "o.shipping_cents",
  tips: "o.tip_cents",
};

/**
 * Cash part of a column for a split order. Shipping and tips take their proportional share and
 * products take the rest, so the three cash parts add up to exactly `split_cash_cents` (what the
 * cashier received) and the transfer side keeps the remainder of every column.
 */
const splitCashPart = (column: BillingColumn) =>
  column === "products"
    ? `(${SPLIT_CASH} - ${SPLIT_CASH_SHARE(BILLING_COLUMNS.shipping)} - ${SPLIT_CASH_SHARE(BILLING_COLUMNS.tips)})`
    : SPLIT_CASH_SHARE(BILLING_COLUMNS[column]);

/** An amount column of the orders paid with `method`; a split order contributes its share. */
const methodAmount = (column: BillingColumn, method: "cash" | "transfer") =>
  method === "cash"
    ? `(CASE WHEN o.payment_method = 'cash' THEN ${BILLING_COLUMNS[column]}
             WHEN o.payment_method = 'split' THEN ${splitCashPart(column)}
             ELSE 0 END)`
    : `(CASE WHEN o.payment_method = 'transfer' THEN ${BILLING_COLUMNS[column]}
             WHEN o.payment_method = 'split' THEN ${BILLING_COLUMNS[column]} - ${splitCashPart(column)}
             ELSE 0 END)`;

const sumOf = (expression: string) => `COALESCE(SUM(${expression}), 0)`;

const ORDERS_WITH = (method: "cash" | "transfer") =>
  `SUM(CASE WHEN o.payment_method IN ('${method}', 'split') THEN 1 ELSE 0 END)`;

/** `unit_price_cents` includes the extras, so they are subtracted to price the products alone. */
const EXTRAS_PER_UNIT = `COALESCE((SELECT SUM(MAX(0, json_extract(opt.value, '$.quantity') - json_extract(opt.value, '$.includedQty'))
                                      * json_extract(opt.value, '$.extraPriceCents'))
                              FROM json_each(i.options_json) AS opt), 0)`;

const ADDON_UNITS = `MAX(0, json_extract(opt.value, '$.quantity') - json_extract(opt.value, '$.includedQty'))`;

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

    async billingTotals(scope) {
      const where = reportWhere(scope, "sales");
      const products = BILLING_COLUMNS.products;
      return all<BillingTotalsRow>(
        `SELECT o.fulfillment AS fulfillment,
                COUNT(*) AS orders,
                ${sumOf(products)} AS productsCents,
                ${sumOf("o.shipping_cents")} AS shippingCents,
                ${sumOf("o.tip_cents")} AS tipsCents,
                ${ORDERS_WITH("cash")} AS cashOrders,
                ${sumOf(methodAmount("products", "cash"))} AS cashProductsCents,
                ${sumOf(methodAmount("shipping", "cash"))} AS cashShippingCents,
                ${sumOf(methodAmount("tips", "cash"))} AS cashTipsCents,
                ${ORDERS_WITH("transfer")} AS transferOrders,
                ${sumOf(methodAmount("products", "transfer"))} AS transferProductsCents,
                ${sumOf(methodAmount("shipping", "transfer"))} AS transferShippingCents,
                ${sumOf(methodAmount("tips", "transfer"))} AS transferTipsCents
           FROM orders o
          WHERE ${where.sql}
          GROUP BY o.fulfillment`,
        where.params,
      );
    },

    async sourceTotals(scope) {
      const where = reportWhere(scope, "sales");
      return all<SourceTotalsRow>(
        `SELECT o.source AS source,
                COUNT(*) AS orders,
                ${sumOf(amountOf("(o.subtotal_cents - o.discount_cents)", scope))} AS productsCents,
                ${sumOf(amountOf("o.total_cents", scope))} AS billedCents
           FROM orders o
          WHERE ${where.sql}
          GROUP BY o.source`,
        where.params,
      );
    },

    async productSales(scope) {
      const where = reportWhere(scope, "sales");
      // A deleted product (`product_id` NULL) is grouped by the snapshot of its name. `MAX(created_at)`
      // makes the bare name come from the latest order, so a renamed product keeps its newer name.
      return all<ProductSalesRow>(
        `SELECT COALESCE(i.product_id, 'name:' || i.name) AS key,
                i.product_id AS productId,
                c.name AS categoryName,
                i.name AS name,
                MAX(o.created_at) AS lastOrderAt,
                COALESCE(SUM(i.quantity), 0) AS units,
                COALESCE(SUM((i.unit_price_cents - ${EXTRAS_PER_UNIT}) * i.quantity), 0) AS revenueCents
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${where.sql}
          GROUP BY key`,
        where.params,
      );
    },

    async addonSales(scope) {
      const where = reportWhere(scope, "sales");
      return all<AddonSalesRow>(
        `SELECT json_extract(opt.value, '$.name') AS name,
                COALESCE(SUM(${ADDON_UNITS} * i.quantity), 0) AS units,
                COALESCE(SUM(${ADDON_UNITS} * json_extract(opt.value, '$.extraPriceCents') * i.quantity), 0) AS revenueCents
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           JOIN json_each(i.options_json) AS opt
          WHERE ${where.sql}
          GROUP BY json_extract(opt.value, '$.name')
         HAVING COALESCE(SUM(${ADDON_UNITS}), 0) > 0`,
        where.params,
      );
    },

    async courierSummary(scope) {
      const where = reportWhere(scope, "sales");
      const found = await row<{
        orders: number;
        shippingCents: number;
        tipsCents: number;
        averageMinutes: number | null;
        averageDistanceM: number | null;
      }>(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(o.shipping_cents), 0) AS shippingCents,
                COALESCE(SUM(o.tip_cents), 0) AS tipsCents,
                AVG(${DELIVERY_MINUTES}) AS averageMinutes,
                AVG(o.delivery_distance_m) AS averageDistanceM
           FROM orders o
          WHERE ${where.sql} AND ${DELIVERY_WITH_COURIER}`,
        where.params,
      );
      return {
        orders: number(found?.orders),
        shippingCents: number(found?.shippingCents),
        tipsCents: number(found?.tipsCents),
        averageMinutes: nullableNumber(found?.averageMinutes),
        averageDistanceM: nullableNumber(found?.averageDistanceM),
      };
    },

    async courierTotals(scope, settledFromMs, settledToMs) {
      const where = reportWhere(scope, "sales");
      // The settled cash only counts on the orders entered into the drawer within the period, so it is
      // a conditional sum and does not narrow the orders of the other columns.
      const settledCash = `COALESCE(SUM(CASE WHEN o.settled_at >= ? AND o.settled_at < ?
        THEN CASE WHEN o.payment_method = 'cash' THEN o.total_cents
                  WHEN o.payment_method = 'split' THEN ${SPLIT_CASH}
                  ELSE 0 END
        ELSE 0 END), 0)`;
      return all<CourierTotalsRow>(
        `SELECT o.courier_member_id AS memberId,
                m.first_name AS firstName,
                m.last_name AS lastName,
                COUNT(*) AS orders,
                COALESCE(SUM(o.shipping_cents), 0) AS shippingCents,
                COALESCE(SUM(o.tip_cents), 0) AS tipsCents,
                AVG(${DELIVERY_MINUTES}) AS averageMinutes,
                ${settledCash} AS cashCents
           FROM orders o
           JOIN restaurant_members m ON m.id = o.courier_member_id AND m.restaurant_id = o.restaurant_id
          WHERE ${where.sql} AND ${DELIVERY_WITH_COURIER}
          GROUP BY o.courier_member_id, m.first_name, m.last_name`,
        [settledFromMs, settledToMs, ...where.params],
      );
    },

    async zoneTotals(scope) {
      const where = reportWhere(scope, "sales");
      return all<ZoneTotalsRow>(
        `SELECT o.delivery_zone_id AS zoneId,
                o.delivery_zone_name AS zoneName,
                COUNT(*) AS orders,
                COALESCE(SUM(o.shipping_cents), 0) AS shippingCents,
                AVG(o.delivery_distance_m) AS averageDistanceM,
                AVG(${DELIVERY_MINUTES}) AS averageMinutes
           FROM orders o
          WHERE ${where.sql} AND ${DELIVERY_WITH_COURIER}
          GROUP BY o.delivery_zone_id, o.delivery_zone_name`,
        where.params,
      );
    },

    async courierOptions(restaurantId, sinceMs) {
      return all<CourierOptionRow>(
        `SELECT m.id AS memberId, m.first_name AS firstName, m.last_name AS lastName
           FROM restaurant_members m
          WHERE m.restaurant_id = ?
            AND (m.is_courier = 1 OR EXISTS (
              SELECT 1 FROM orders o
               WHERE o.restaurant_id = m.restaurant_id AND o.courier_member_id = m.id
                 AND o.fulfillment = 'delivery' AND o.created_at >= ?))
          ORDER BY lower(m.first_name), lower(m.last_name), m.id`,
        [restaurantId, sinceMs],
      );
    },

    async deliveryMode(restaurantId) {
      const found = await row<{ mode: string }>(
        "SELECT delivery_mode AS mode FROM restaurant_settings WHERE restaurant_id = ?",
        [restaurantId],
      );
      return found?.mode === "zones" ? "zones" : "flat";
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
