import {
  OFF_SHIFT_ID,
  ORDER_SOURCES,
  PAYMENT_SPLIT_NOTE,
  TAB_FILTERS,
  UNCATEGORIZED_LABEL,
  cashTotalsFromSnapshot,
  daysInRange,
  effectivePermissions,
  groupCashMovements,
  localDateKey,
  localDayRange,
  maskCashReportWidgets,
  percentage,
  percentChange,
  planLimitsFor,
  previousRange,
  reportRange,
  reportRangeProblem,
  shiftOf,
  shiftsFor,
  yearBeforeRange,
  withoutCents,
  type BillingPaymentBlock,
  type BillingReport,
  type BillingSourceRow,
  type BillingWidgets,
  type CashMethodReportRow,
  type CashReport,
  type CashSessionReportRow,
  type CashSessionTotalsRow,
  type CashShiftRow,
  type CashTotals,
  type CashWidgets,
  type CouriersCourierRow,
  type CouriersReport,
  type CouriersWidgets,
  type CouriersZoneRow,
  type EvolutionReport,
  type EvolutionWidgets,
  type ReportFilterKey,
  type ReportFilters,
  type ReportMover,
  type ReportPaymentMethodRow,
  type ReportRange,
  type ReportTrendPoint,
  type ReportMeta,
  type SalesCategoryRow,
  type SalesReport,
  type SalesWidgets,
} from "@menucito/shared";
import type { MemberContext } from "../env";
import type { CashSessionRow } from "../db/schema";
import type { HoursRepository } from "../repositories/hours";
import type { CashRepository } from "../repositories/cash";
import { toCashSession } from "../repositories/cash";
import {
  createReportsRepository,
  type BillingTotalsRow,
  type DailySeriesRow,
  type HourGridRow,
  type ReportsRepository,
  type ReportScope,
  type SalesSummaryRow,
} from "../repositories/reports";
import { createCashRepository } from "../repositories/cash";
import { createHoursRepository } from "../repositories/hours";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import type { CashService } from "./cash";
import { cashServiceFor } from "./cash";
import { PlanFeatureError, ReportRangeError, RestaurantNotFoundError } from "./errors";

const YEAR_MS = 365 * 86_400_000;

export interface ReportsDependencies {
  reports: ReportsRepository;
  restaurants: RestaurantsRepository;
  cash: CashRepository;
  /** The Cajas screen: the open drawer is built with the same numbers and the same blind close. */
  drawer: Pick<CashService, "current">;
  hours: HoursRepository;
  now?: () => Date;
  limitsFor?: typeof planLimitsFor;
}

function emptySummary(): SalesSummaryRow {
  return { orders: 0, billedCents: 0, subtotalCents: 0, productsCents: 0, shippingCents: 0, tipsCents: 0, discountCents: 0 };
}

/** Daily rows grouped by fecha, with Delivery and Take away split. */
function trendPoints(rows: readonly DailySeriesRow[]): ReportTrendPoint[] {
  const byDate = new Map<string, ReportTrendPoint>();
  for (const row of rows) {
    const point =
      byDate.get(row.date) ??
      ({
        date: row.date,
        billedCents: 0,
        orders: 0,
        productsCents: 0,
        deliveryCents: 0,
        deliveryOrders: 0,
        takeawayCents: 0,
        takeawayOrders: 0,
      } satisfies ReportTrendPoint);
    point.billedCents += row.billedCents;
    point.orders += row.orders;
    point.productsCents += row.productsCents;
    if (row.fulfillment === "delivery") {
      point.deliveryCents += row.billedCents;
      point.deliveryOrders += row.orders;
    } else {
      point.takeawayCents += row.billedCents;
      point.takeawayOrders += row.orders;
    }
    byDate.set(row.date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 7 rows (Monday first) by 24 hours, as the heatmap draws them. */
function heatmapGrid(rows: readonly HourGridRow[]): { max: number; cells: number[][] } {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let max = 0;
  for (const row of rows) {
    const index = (row.weekday + 6) % 7;
    const current = cells[index]?.[row.hour] ?? 0;
    cells[index]![row.hour] = current + row.orders;
    max = Math.max(max, current + row.orders);
  }
  return { max, cells };
}

function moversOf(current: readonly { name: string; units: number }[], previous: readonly { name: string; units: number }[]) {
  const currentUnits = new Map(current.map((row) => [row.name, row.units]));
  const previousUnits = new Map(previous.map((row) => [row.name, row.units]));
  const names = new Set([...currentUnits.keys(), ...previousUnits.keys()]);
  const movers: ReportMover[] = [...names].map((name) => {
    const units = currentUnits.get(name) ?? 0;
    const before = previousUnits.get(name) ?? 0;
    return { name, units, previousUnits: before, delta: units - before };
  });
  const up = movers
    .filter((row) => row.delta >= 1)
    .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name))
    .slice(0, 5);
  const down = movers
    .filter((row) => row.delta <= -1)
    .sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name))
    .slice(0, 5);
  return { up, down };
}

const MODALITIES = ["delivery", "takeaway"] as const;

/** One decimal, as the report shows minutes and kilometres. */
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

const minutesOf = (value: number | null) => (value === null ? null : oneDecimal(value));

const kilometresOf = (value: number | null) => (value === null ? null : oneDecimal(value / 1000));

/** Difference of a closed session: the stored one, or counted − expected when it is missing. */
function differenceOf(session: CashSessionRow, totals: CashTotals): number {
  if (session.differenceCents !== null) return session.differenceCents;
  const counted = session.countedCashCents ?? 0;
  return counted - (session.expectedCashCents ?? totals.expectedCashCents ?? 0);
}

function zeroBillingTotals(fulfillment: (typeof MODALITIES)[number]): BillingTotalsRow {
  return {
    fulfillment,
    orders: 0,
    productsCents: 0,
    shippingCents: 0,
    tipsCents: 0,
    cashOrders: 0,
    cashProductsCents: 0,
    cashShippingCents: 0,
    cashTipsCents: 0,
    transferOrders: 0,
    transferProductsCents: 0,
    transferShippingCents: 0,
    transferTipsCents: 0,
  };
}

const billedOf = (row: Pick<BillingTotalsRow, "productsCents" | "shippingCents" | "tipsCents">) =>
  row.productsCents + row.shippingCents + row.tipsCents;

/** A "por medio de pago" table: each method's share and the real totals (change 16b). */
function paymentBlock(
  row: BillingTotalsRow,
  fulfillment: (typeof MODALITIES)[number],
  method: "cash" | "transfer" | null,
): BillingPaymentBlock {
  const methodRow = (entry: "cash" | "transfer") => {
    const orders = entry === "cash" ? row.cashOrders : row.transferOrders;
    const productsCents = entry === "cash" ? row.cashProductsCents : row.transferProductsCents;
    const shippingCents = fulfillment === "delivery" ? (entry === "cash" ? row.cashShippingCents : row.transferShippingCents) : 0;
    const tipsCents = fulfillment === "delivery" ? (entry === "cash" ? row.cashTipsCents : row.transferTipsCents) : 0;
    return {
      method: entry,
      orders,
      ticketCents: orders === 0 ? 0 : Math.round(productsCents / orders),
      productsCents,
      ...(fulfillment === "delivery" ? { shippingCents, tipsCents } : {}),
      billedCents: productsCents + shippingCents + tipsCents,
    };
  };
  return {
    // Under the Efectivo or Transferencia filter only that method's share makes sense (as in 16a).
    rows: (method ? [method] : (["cash", "transfer"] as const)).map(methodRow),
    total: method
      ? { ...methodRow(method), method: undefined }
      : {
          orders: row.orders,
          ticketCents: row.orders === 0 ? 0 : Math.round(row.productsCents / row.orders),
          productsCents: row.productsCents,
          ...(fulfillment === "delivery" ? { shippingCents: row.shippingCents, tipsCents: row.tipsCents } : {}),
          billedCents: billedOf(row),
        },
  };
}

export function createReportsService({
  reports,
  restaurants,
  cash,
  drawer: cashDrawer,
  hours,
  now = () => new Date(),
  limitsFor = planLimitsFor,
}: ReportsDependencies) {
  async function assertPlan(restaurantId: string) {
    const restaurant = await restaurants.findById(restaurantId);
    if (!restaurant) throw new RestaurantNotFoundError();
    if (!limitsFor(restaurant.plan).reports) {
      throw new PlanFeatureError("Los reportes no están incluidos en tu plan");
    }
    return restaurant;
  }

  /** The permission set, the range, the filters the member may use and the scopes of a report (change 16a). */
  async function reportContext(
    restaurantId: string,
    member: MemberContext,
    filters: ReportFilters,
    allowed?: readonly ReportFilterKey[],
  ) {
    const permissions = new Set<string>(effectivePermissions(member));
    const can = (key: string) => permissions.has(key);
    const usable = (key: ReportFilterKey) => can(key) && (!allowed || allowed.includes(key));
    const range = reportRange(filters, can("stats.f.date"), now());
    const problem = reportRangeProblem(range);
    if (problem) throw new ReportRangeError(problem);

    const scoped: ReportFilters = {
      ...(usable("stats.f.shift") && filters.shift ? { shift: filters.shift } : {}),
      ...(usable("stats.f.fulfillment") && filters.fulfillment ? { fulfillment: filters.fulfillment } : {}),
      ...(usable("stats.f.payment") && filters.payment ? { payment: filters.payment } : {}),
      ...(usable("stats.f.source") && filters.source ? { source: filters.source } : {}),
      ...(usable("stats.f.courier") && filters.courier ? { courier: filters.courier } : {}),
    };
    const slots = scoped.shift ? await hours.listSlots(restaurantId) : [];
    const scopeFor = (target: ReportRange): ReportScope => ({
      restaurantId,
      fromMs: localDayRange(target.from)[0],
      toMs: localDayRange(target.to)[1],
      filters: scoped,
      hours: slots,
    });
    return { can, amounts: can("stats.amounts"), range, scoped, scopeFor };
  }

  async function evolution(restaurantId: string, member: MemberContext, filters: ReportFilters): Promise<EvolutionReport> {
    await assertPlan(restaurantId);
    const { can, amounts, range, scoped, scopeFor } = await reportContext(restaurantId, member, filters);

    const previous = previousRange(range);
    const year = yearBeforeRange(range);
    const scope = scopeFor(range);
    const previousScope = scopeFor(previous);

    const widgets: EvolutionWidgets = {};
    const needsPrevious =
      can("stats.w.evolution.billed") ||
      can("stats.w.evolution.orders") ||
      can("stats.w.evolution.ticket") ||
      can("stats.w.evolution.shipping") ||
      can("stats.w.evolution.discounts") ||
      can("stats.w.evolution.cancellations");

    // The current summary always runs: it also tells the admin whether the period has any sale.
    const [summary, previousSummary] = await Promise.all([
      reports.salesSummary(scope),
      needsPrevious ? reports.salesSummary(previousScope) : Promise.resolve(emptySummary()),
    ]);
    const ordersCount = summary.orders;

    if (can("stats.w.evolution.billed")) {
      widgets.billed = {
        currentCents: summary.billedCents,
        previousCents: previousSummary.billedCents,
        changePercent: percentChange(summary.billedCents, previousSummary.billedCents),
      };
    }
    if (can("stats.w.evolution.orders")) {
      widgets.orders = {
        current: ordersCount,
        previous: previousSummary.orders,
        changePercent: percentChange(ordersCount, previousSummary.orders),
      };
    }
    if (can("stats.w.evolution.ticket")) {
      const ticket = (row: SalesSummaryRow) => (row.orders === 0 ? 0 : Math.round(row.productsCents / row.orders));
      widgets.ticket = {
        currentCents: ticket(summary),
        previousCents: ticket(previousSummary),
        changePercent: percentChange(ticket(summary), ticket(previousSummary)),
      };
    }
    if (can("stats.w.evolution.shipping")) {
      widgets.shipping = {
        currentCents: summary.shippingCents,
        previousCents: previousSummary.shippingCents,
        changePercent: percentChange(summary.shippingCents, previousSummary.shippingCents),
      };
    }
    if (can("stats.w.evolution.discounts")) {
      widgets.discounts = {
        currentCents: summary.discountCents,
        previousCents: previousSummary.discountCents,
        changePercent: percentChange(summary.discountCents, previousSummary.discountCents),
      };
    }
    let cancelled: { count: number; totalCents: number } | null = null;
    if (can("stats.w.evolution.cancellations")) {
      let previousCancelled: { count: number; totalCents: number };
      [cancelled, previousCancelled] = await Promise.all([
        reports.cancellationsSummary(scope),
        reports.cancellationsSummary(previousScope),
      ]);
      const rate = (cancelledCount: number, salesCount: number) =>
        percentage(cancelledCount, cancelledCount + salesCount);
      widgets.cancellations = {
        count: {
          current: cancelled.count,
          previous: previousCancelled.count,
          changePercent: percentChange(cancelled.count, previousCancelled.count),
        },
        lostCents: cancelled.totalCents,
        previousLostCents: previousCancelled.totalCents,
        ratePercent: {
          current: rate(cancelled.count, ordersCount),
          previous: rate(previousCancelled.count, previousSummary.orders),
          changePercent: percentChange(rate(cancelled.count, ordersCount), rate(previousCancelled.count, previousSummary.orders)),
        },
      };
    }
    if (can("stats.w.evolution.pnl")) {
      widgets.pnl = {
        productsCents: summary.subtotalCents,
        shippingCents: summary.shippingCents,
        tipsCents: summary.tipsCents,
        discountCents: summary.discountCents,
        billedCents: summary.billedCents,
      };
    }

    const needsHours = can("stats.w.evolution.pace") || can("stats.w.evolution.heatmap");
    const grid = needsHours ? await reports.hourGrid(scope) : [];

    if (can("stats.w.evolution.pace")) {
      const byDay = Array<number>(7).fill(0);
      const byHour = Array<number>(24).fill(0);
      let peakDay: number | null = null;
      let peakHour: number | null = null;
      for (const row of grid) {
        byDay[row.weekday] = (byDay[row.weekday] ?? 0) + row.orders;
        byHour[row.hour] = (byHour[row.hour] ?? 0) + row.orders;
      }
      for (let day = 0; day < 7; day += 1) {
        if ((byDay[day] ?? 0) > 0 && (peakDay === null || (byDay[day] ?? 0) > (byDay[peakDay] ?? 0))) peakDay = day;
      }
      for (let hour = 0; hour < 24; hour += 1) {
        if ((byHour[hour] ?? 0) > 0 && (peakHour === null || (byHour[hour] ?? 0) > (byHour[peakHour] ?? 0))) peakHour = hour;
      }
      widgets.pace = {
        peakDay,
        peakHour,
        ordersPerDay: Math.round((ordersCount / daysInRange(range)) * 10) / 10,
        newCustomers: await reports.newCustomers(restaurantId, localDayRange(range.from)[0], localDayRange(range.to)[1]),
      };
    }

    if (can("stats.w.evolution.heatmap")) widgets.heatmap = heatmapGrid(grid);

    if (can("stats.w.evolution.trend")) {
      const [currentRows, previousRows, yearRows] = await Promise.all([
        reports.dailySeries(scope),
        reports.dailySeries(previousScope),
        reports.dailySeries(scopeFor(year)),
      ]);
      const trend: NonNullable<EvolutionWidgets["trend"]> = {
        days: trendPoints(currentRows),
        previous: trendPoints(previousRows),
        year: trendPoints(yearRows),
      };
      // Projection of the current month: month-to-date billed divided by elapsed days, times days of the month.
      const today = localDateKey(now().getTime());
      const currentMonth = today.slice(0, 7);
      if (range.from.slice(0, 7) <= currentMonth && range.to.slice(0, 7) >= currentMonth) {
        const [yearNumber = 0, monthNumber = 1] = currentMonth.split("-").map(Number);
        const monthStart = `${currentMonth}-01`;
        const daysInMonth = new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate();
        const elapsed = Number(today.slice(8, 10));
        const monthRows = await reports.dailySeries(scopeFor({ from: monthStart, to: today }));
        const monthToDate = monthRows.reduce((sum, row) => sum + row.billedCents, 0);
        trend.projectionCents = Math.round((monthToDate / elapsed) * daysInMonth);
      }
      widgets.trend = trend;
    }

    if (can("stats.w.evolution.movers")) {
      const [currentItems, previousItems] = await Promise.all([
        reports.itemUnits(scope),
        reports.itemUnits(previousScope),
      ]);
      widgets.movers = moversOf(currentItems, previousItems);
    }

    if (can("stats.w.evolution.payment_methods")) {
      const totals = await reports.paymentTotals(scope);
      const group = (method: string) => totals.find((row) => row.method === method);
      const cashOrders = (group("cash")?.orders ?? 0) + (group("split")?.orders ?? 0);
      const transferOrders = (group("transfer")?.orders ?? 0) + (group("split")?.orders ?? 0);
      const cashCents = (group("cash")?.cashCents ?? 0) + (group("split")?.cashCents ?? 0);
      const transferCents = (group("transfer")?.transferCents ?? 0) + (group("split")?.transferCents ?? 0);
      // Under "Efectivo" or "Transferencia" only that method's row makes sense (a split order adds its share).
      const parts = [
        { method: "cash" as const, orders: cashOrders, billedCents: cashCents },
        { method: "transfer" as const, orders: transferOrders, billedCents: transferCents },
      ].filter((row) => (scoped.payment === "cash" || scoped.payment === "transfer" ? row.method === scoped.payment : true));
      const billed = parts.reduce((sum, row) => sum + row.billedCents, 0);
      const ordersTotal = parts.reduce((sum, row) => sum + row.orders, 0);
      const rows: ReportPaymentMethodRow[] = parts.map((row) => ({
        ...row,
        percent: amounts ? percentage(row.billedCents, billed) : percentage(row.orders, ordersTotal),
      }));
      widgets.payment_methods = { rows, note: PAYMENT_SPLIT_NOTE };
    }

    if (can("stats.w.evolution.customers")) {
      const rows = await reports.customers(scope);
      const returning = rows.filter((row) => row.orders >= 2 || row.earlier > 0);
      const returningBilledCents = returning.reduce((sum, row) => sum + row.billedCents, 0);
      widgets.customers = {
        unique: rows.length,
        returning: returning.length,
        ratePercent: percentage(returning.length, rows.length),
        returningBilledCents,
        top: [...rows]
          .sort((a, b) => b.billedCents - a.billedCents || a.name.localeCompare(b.name))
          .slice(0, 10)
          .map((row) => ({ name: row.name, phone: row.phone, orders: row.orders, billedCents: row.billedCents })),
      };
    }

    const hasActivity =
      summary.orders > 0 || (cancelled ?? (await reports.cancellationsSummary(scope))).count > 0;

    return {
      range,
      previousRange: previous,
      hasActivity,
      widgets: amounts ? widgets : withoutCents(widgets),
    };
  }

  return {
    evolution,

    /** Facturación tab (change 16b). */
    async billing(restaurantId: string, member: MemberContext, filters: ReportFilters): Promise<BillingReport> {
      const restaurant = await assertPlan(restaurantId);
      const { can, amounts, range, scoped, scopeFor } = await reportContext(restaurantId, member, filters);
      const scope = scopeFor(range);
      const filteredMethod = scoped.payment === "cash" || scoped.payment === "transfer" ? scoped.payment : null;
      const methods = filteredMethod ? [filteredMethod] : (["cash", "transfer"] as const);
      const needsPayments = MODALITIES.some((fulfillment) => can(`stats.w.billing.${fulfillment}`)) ||
        can("stats.w.billing.total") ||
        can("stats.w.billing.orders_total");
      const [totals, sources] = await Promise.all([
        needsPayments ? reports.billingTotals(scope) : Promise.resolve([]),
        can("stats.w.billing.source") ? reports.sourceTotals(scope) : Promise.resolve([]),
      ]);
      const byFulfillment = new Map(totals.map((row) => [row.fulfillment, row]));
      // The Modality filter leaves a single table; a disabled modality only appears when it had sales.
      const shown = (fulfillment: (typeof MODALITIES)[number]) =>
        (!scoped.fulfillment || scoped.fulfillment === fulfillment) &&
        ((fulfillment === "delivery" ? restaurant.delivery : restaurant.takeaway) ||
          (byFulfillment.get(fulfillment)?.orders ?? 0) > 0);

      const widgets: BillingWidgets = {};

      if (can("stats.w.billing.total")) {
        const billedBy = {
          cash: totals.reduce((sum, row) => sum + row.cashProductsCents + row.cashShippingCents + row.cashTipsCents, 0),
          transfer: totals.reduce((sum, row) => sum + row.transferProductsCents + row.transferShippingCents + row.transferTipsCents, 0),
        };
        const ordersBy = {
          cash: totals.reduce((sum, row) => sum + row.cashOrders, 0),
          transfer: totals.reduce((sum, row) => sum + row.transferOrders, 0),
        };
        const billedCents = filteredMethod ? billedBy[filteredMethod] : totals.reduce((sum, row) => sum + billedOf(row), 0);
        const orders = filteredMethod ? ordersBy[filteredMethod] : totals.reduce((sum, row) => sum + row.orders, 0);
        widgets.total = {
          billedCents,
          orders,
          rows: methods.map((method) => ({
            method,
            orders: ordersBy[method],
            billedCents: billedBy[method],
            percent: amounts
              ? percentage(billedBy[method], billedCents)
              : percentage(ordersBy[method], filteredMethod ? ordersBy[method] : ordersBy.cash + ordersBy.transfer),
          })),
        };
      }

      if (can("stats.w.billing.orders_total")) {
        const rows = MODALITIES.filter(shown).map((fulfillment) => ({
          fulfillment,
          orders: byFulfillment.get(fulfillment)?.orders ?? 0,
        }));
        const orders = rows.reduce((sum, row) => sum + row.orders, 0);
        widgets.orders_total = { orders, rows: rows.map((row) => ({ ...row, percent: percentage(row.orders, orders) })) };
      }

      for (const fulfillment of MODALITIES) {
        if (can(`stats.w.billing.${fulfillment}`) && shown(fulfillment)) {
          widgets[fulfillment] = paymentBlock(byFulfillment.get(fulfillment) ?? zeroBillingTotals(fulfillment), fulfillment, filteredMethod);
        }
      }

      if (can("stats.w.billing.source")) {
        const totalBilled = sources.reduce((sum, row) => sum + row.billedCents, 0);
        const totalOrders = sources.reduce((sum, row) => sum + row.orders, 0);
        const bySource = new Map(sources.map((row) => [row.source, row]));
        const rows: BillingSourceRow[] = ORDER_SOURCES.map((source) => {
          const row = bySource.get(source);
          const orders = row?.orders ?? 0;
          const billedCents = row?.billedCents ?? 0;
          return {
            source,
            orders,
            ticketCents: orders === 0 ? 0 : Math.round((row?.productsCents ?? 0) / orders),
            billedCents,
            percent: amounts ? percentage(billedCents, totalBilled) : percentage(orders, totalOrders),
          };
        });
        widgets.source = rows;
      }

      const hasActivity = (await reports.salesSummary(scope)).orders > 0;
      return { range, hasActivity, widgets: amounts ? widgets : withoutCents(widgets) };
    },

    /** Ventas tab (change 16b). */
    async sales(restaurantId: string, member: MemberContext, filters: ReportFilters): Promise<SalesReport> {
      await assertPlan(restaurantId);
      const { can, amounts, range, scopeFor } = await reportContext(restaurantId, member, filters);
      const scope = scopeFor(range);
      const needsProducts =
        can("stats.w.sales.top") || can("stats.w.sales.categories") || can("stats.w.sales.products");
      const [products, addons] = await Promise.all([
        needsProducts ? reports.productSales(scope) : Promise.resolve([]),
        can("stats.w.sales.addons") ? reports.addonSales(scope) : Promise.resolve([]),
      ]);
      const widgets: SalesWidgets = {};

      if (can("stats.w.sales.top")) {
        const byUnits = [...products]
          .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))
          .slice(0, 10)
          .map((row) => ({ name: row.name, units: row.units, revenueCents: row.revenueCents }));
        widgets.top = { byUnits };
        if (amounts) {
          widgets.top.byRevenue = [...products]
            .sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name))
            .slice(0, 10)
            .map((row) => ({ name: row.name, units: row.units, revenueCents: row.revenueCents }));
        }
      }

      if (can("stats.w.sales.categories")) {
        const grouped = new Map<string, SalesCategoryRow>();
        for (const row of products) {
          const category = row.categoryName ?? UNCATEGORIZED_LABEL;
          const entry = grouped.get(category) ?? { category, products: 0, units: 0, revenueCents: 0, percent: 0 };
          entry.products += 1;
          entry.units += row.units;
          entry.revenueCents = (entry.revenueCents ?? 0) + row.revenueCents;
          grouped.set(category, entry);
        }
        const totalUnits = products.reduce((sum, row) => sum + row.units, 0);
        const totalRevenue = products.reduce((sum, row) => sum + row.revenueCents, 0);
        const rows = [...grouped.values()]
          .map((row) => ({
            ...row,
            percent: amounts ? percentage(row.revenueCents ?? 0, totalRevenue) : percentage(row.units, totalUnits),
          }))
          .sort((a, b) =>
            amounts
              ? (b.revenueCents ?? 0) - (a.revenueCents ?? 0) || a.category.localeCompare(b.category)
              : b.units - a.units || a.category.localeCompare(b.category),
          );
        widgets.categories = {
          rows,
          total: { category: "Total", products: products.length, units: totalUnits, revenueCents: totalRevenue, percent: 100 },
        };
      }

      if (can("stats.w.sales.products")) {
        widgets.products = products
          .map((row) => ({
            productId: row.productId,
            category: row.categoryName ?? UNCATEGORIZED_LABEL,
            name: row.name,
            units: row.units,
            revenueCents: row.revenueCents,
          }))
          .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
      }

      if (can("stats.w.sales.addons")) {
        widgets.addons = addons
          .map((row) => ({ name: row.name, units: row.units, revenueCents: row.revenueCents }))
          .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
      }

      const hasActivity = (await reports.salesSummary(scope)).orders > 0;
      return { range, hasActivity, widgets: amounts ? widgets : withoutCents(widgets) };
    },

    /** Repartidores tab (change 16c). */
    async couriers(restaurantId: string, member: MemberContext, filters: ReportFilters): Promise<CouriersReport> {
      await assertPlan(restaurantId);
      const { can, amounts, range, scopeFor } = await reportContext(
        restaurantId,
        member,
        filters,
        TAB_FILTERS["stats.tab.couriers"],
      );
      const previous = previousRange(range);
      const needsPrevious =
        can("stats.w.couriers.orders") ||
        can("stats.w.couriers.shipping") ||
        can("stats.w.couriers.tips") ||
        can("stats.w.couriers.time");
      const [summary, previousSummary] = await Promise.all([
        reports.courierSummary(scopeFor(range)),
        needsPrevious
          ? reports.courierSummary(scopeFor(previous))
          : Promise.resolve({ orders: 0, shippingCents: 0, tipsCents: 0, averageMinutes: null, averageDistanceM: null }),
      ]);

      const widgets: CouriersWidgets = {};
      const countMetric = (current: number, before: number) => ({
        current,
        previous: before,
        changePercent: percentChange(current, before),
      });
      const centsMetric = (current: number, before: number) => ({
        currentCents: current,
        previousCents: before,
        changePercent: percentChange(current, before),
      });

      if (can("stats.w.couriers.orders")) widgets.orders = countMetric(summary.orders, previousSummary.orders);
      if (can("stats.w.couriers.shipping")) {
        widgets.shipping = centsMetric(summary.shippingCents, previousSummary.shippingCents);
      }
      if (can("stats.w.couriers.tips")) widgets.tips = centsMetric(summary.tipsCents, previousSummary.tipsCents);
      if (can("stats.w.couriers.time")) {
        const currentMinutes = minutesOf(summary.averageMinutes);
        const previousMinutes = minutesOf(previousSummary.averageMinutes);
        widgets.time = {
          currentMinutes,
          previousMinutes,
          changePercent:
            currentMinutes === null || previousMinutes === null ? null : percentChange(currentMinutes, previousMinutes),
        };
      }

      if (can("stats.w.couriers.by_courier")) {
        const rows = await reports.courierTotals(
          scopeFor(range),
          localDayRange(range.from)[0],
          localDayRange(range.to)[1],
        );
        const mapped: CouriersCourierRow[] = rows
          .map((row) => ({
            memberId: row.memberId,
            name: `${row.firstName} ${row.lastName}`.trim() || "Repartidor",
            orders: row.orders,
            shippingCents: row.shippingCents,
            tipsCents: row.tipsCents,
            averageMinutes: minutesOf(row.averageMinutes),
            cashCents: row.cashCents,
          }))
          .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, "es"));
        widgets.by_courier = {
          rows: mapped,
          total: {
            memberId: null,
            name: "Total",
            orders: summary.orders,
            shippingCents: summary.shippingCents,
            tipsCents: summary.tipsCents,
            averageMinutes: minutesOf(summary.averageMinutes),
            cashCents: mapped.reduce((sum, row) => sum + (row.cashCents ?? 0), 0),
          },
        };
      }

      if (can("stats.w.couriers.by_zone")) {
        const [mode, zoneRows] = await Promise.all([reports.deliveryMode(restaurantId), reports.zoneTotals(scopeFor(range))]);
        const total: CouriersZoneRow = {
          zoneId: null,
          name: "Total",
          orders: summary.orders,
          shippingCents: summary.shippingCents,
          distanceKm: kilometresOf(summary.averageDistanceM),
          averageMinutes: minutesOf(summary.averageMinutes),
        };
        if (mode === "flat") {
          widgets.by_zone = { rows: [{ ...total, name: "Tarifa fija" }], total };
        } else {
          const rows: CouriersZoneRow[] = zoneRows
            .map((row) => ({
              zoneId: row.zoneId,
              name: row.zoneName?.trim() || "Sin zona",
              orders: row.orders,
              shippingCents: row.shippingCents,
              distanceKm: kilometresOf(row.averageDistanceM),
              averageMinutes: minutesOf(row.averageMinutes),
            }))
            .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, "es"));
          widgets.by_zone = { rows, total };
        }
      }

      return {
        range,
        previousRange: previous,
        hasActivity: summary.orders > 0,
        widgets: amounts ? widgets : withoutCents(widgets),
      };
    },

    /** Arqueos tab (change 16c). */
    async cash(restaurantId: string, member: MemberContext, filters: ReportFilters): Promise<CashReport> {
      await assertPlan(restaurantId);
      const { can, amounts, range, scoped } = await reportContext(
        restaurantId,
        member,
        filters,
        TAB_FILTERS["stats.tab.cash"],
      );
      const [fromMs] = localDayRange(range.from);
      const rangeEnd = localDayRange(range.to)[1];
      const slots = await hours.listSlots(restaurantId);
      const shifts = shiftsFor(slots);
      const shiftLabels = new Map(shifts.map((shift) => [shift.id, shift.label]));
      shiftLabels.set(OFF_SHIFT_ID, "Fuera de horario");

      const [sessionRows, snapshotRows, salesRows, movementRows, manualRows, drawer] = await Promise.all([
        cash.sessionsOpenedBetween(restaurantId, fromMs, rangeEnd),
        cash.snapshotTotalsBetween(restaurantId, fromMs, rangeEnd),
        cash.salesTotalsBetween(restaurantId, fromMs, rangeEnd),
        cash.movementTotalsBetween(restaurantId, fromMs, rangeEnd),
        can("stats.w.cash.movements")
          ? cash.manualMovementGroupsBetween(restaurantId, fromMs, rangeEnd)
          : Promise.resolve([]),
        can("stats.w.cash.open")
          ? cashDrawer.current(restaurantId, can("cash.expected"))
          : Promise.resolve(null),
      ]);

      const sessions = sessionRows.filter(
        (row) => !scoped.shift || shiftOf(row.openedAt.getTime(), slots) === scoped.shift,
      );
      // A closed session keeps the numbers of its close, as the Cajas history shows them; only the open
      // one is computed from its live orders and movements.
      const sessionIds = new Set(sessions.filter((row) => row.closedAt === null).map((row) => row.id));
      const closedIds = new Set(sessions.filter((row) => row.closedAt !== null).map((row) => row.id));

      // One totals row per method, as the close snapshot stores them: computeCashTotals is not fed
      // with split sales, they arrive as `order_split_income` movements.
      const totalsBySession = new Map<string, CashSessionTotalsRow[]>();
      const totalsFor = (sessionId: string, method: "cash" | "transfer"): CashSessionTotalsRow => {
        const list = totalsBySession.get(sessionId) ?? [];
        let found = list.find((row) => row.method === method);
        if (!found) {
          found = {
            method,
            salesCount: 0,
            salesCents: 0,
            incomeCount: 0,
            incomeCents: 0,
            expenseCount: 0,
            expenseCents: 0,
            tipCount: 0,
            tipCents: 0,
          };
          list.push(found);
          totalsBySession.set(sessionId, list);
        }
        return found;
      };
      for (const row of snapshotRows) {
        if (!closedIds.has(row.sessionId)) continue;
        const { sessionId, ...totals } = row;
        totalsBySession.set(sessionId, [...(totalsBySession.get(sessionId) ?? []), totals]);
      }
      for (const row of salesRows) {
        if (!sessionIds.has(row.sessionId)) continue;
        const target = totalsFor(row.sessionId, row.method);
        target.salesCount += row.salesCount;
        target.salesCents += row.salesCents;
        target.tipCount += row.tipCount;
        target.tipCents += row.tipCents;
      }
      for (const row of movementRows) {
        if (!sessionIds.has(row.sessionId)) continue;
        const target = totalsFor(row.sessionId, row.method);
        target.incomeCount += row.incomeCount;
        target.incomeCents += row.incomeCents;
        target.expenseCount += row.expenseCount;
        target.expenseCents += row.expenseCents;
      }

      const computed = sessions.map((row) => {
        const view = toCashSession(row);
        return {
          row,
          totals: cashTotalsFromSnapshot(view, totalsBySession.get(row.id) ?? []),
          shift: shiftOf(row.openedAt.getTime(), slots),
        };
      });
      const closed = computed.filter((entry) => entry.row.closedAt !== null);

      const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
      const totalSalesCents = sum(computed.map((entry) => entry.totals.salesCents));
      const totalOrders = sum(computed.map((entry) => entry.totals.salesCount));
      const totalIncomeCents = sum(
        computed.map((entry) => (entry.totals.cash.incomeCents ?? 0) + (entry.totals.transfer.incomeCents ?? 0)),
      );
      const totalExpenseCents = sum(
        computed.map((entry) => (entry.totals.cash.expenseCents ?? 0) + (entry.totals.transfer.expenseCents ?? 0)),
      );

      const widgets: CashWidgets = {};

      if (can("stats.w.cash.open") && drawer?.session) {
        const totals = drawer.totals;
        widgets.open = {
          openedAt: drawer.session.openedAt,
          openedByName: drawer.session.openedByName,
          cashSalesCount: totals?.cash.salesCount ?? 0,
          cashSalesCents: totals?.cash.salesCents,
          openingCashCents: totals?.cash.openingCents ?? undefined,
          cashIncomeCents: totals?.cash.incomeCents ?? undefined,
          cashExpenseCents: totals?.cash.expenseCents ?? undefined,
          cashCents: totals?.cash.totalCents ?? undefined,
          transferSalesCount: totals?.transfer.salesCount ?? 0,
          transferSalesCents: totals?.transfer.salesCents,
          onTheStreet: drawer.onTheStreet,
        };
      }

      if (can("stats.w.cash.kpis")) {
        const differenceCents = sum(closed.map((entry) => differenceOf(entry.row, entry.totals)));
        widgets.kpis = {
          sessions: computed.length,
          closed: closed.length,
          inProgress: computed.length - closed.length,
          salesCents: totalSalesCents,
          orders: totalOrders,
          incomeCents: totalIncomeCents,
          expenseCents: totalExpenseCents,
          differenceCents,
          expectedCents: sum(closed.map((entry) => entry.row.expectedCashCents ?? entry.totals.expectedCashCents ?? 0)),
          countedCents: sum(closed.map((entry) => entry.row.countedCashCents ?? 0)),
          balanced: closed.filter((entry) => differenceOf(entry.row, entry.totals) === 0).length,
        };
      }

      if (can("stats.w.cash.by_shift")) {
        const order = new Map(shifts.map((shift, index) => [shift.id, index]));
        const groups = new Map<string, typeof computed>();
        for (const entry of computed) {
          const list = groups.get(entry.shift) ?? [];
          list.push(entry);
          groups.set(entry.shift, list);
        }
        const rows: CashShiftRow[] = [...groups.entries()]
          .map(([shift, entries]) => {
            const salesCents = sum(entries.map((entry) => entry.totals.salesCents));
            const orders = sum(entries.map((entry) => entry.totals.salesCount));
            return {
              shift,
              label: shiftLabels.get(shift) ?? "Fuera de horario",
              sessions: entries.length,
              orders,
              salesCents,
              percent: amounts ? percentage(salesCents, totalSalesCents) : percentage(orders, totalOrders),
              expenseCents: sum(
                entries.map((entry) => (entry.totals.cash.expenseCents ?? 0) + (entry.totals.transfer.expenseCents ?? 0)),
              ),
              differenceCents: sum(
                entries
                  .filter((entry) => entry.row.closedAt !== null)
                  .map((entry) => differenceOf(entry.row, entry.totals)),
              ),
            };
          })
          .sort(
            (a, b) =>
              (a.shift === OFF_SHIFT_ID ? Number.MAX_SAFE_INTEGER : (order.get(a.shift) ?? Number.MAX_SAFE_INTEGER)) -
                (b.shift === OFF_SHIFT_ID ? Number.MAX_SAFE_INTEGER : (order.get(b.shift) ?? Number.MAX_SAFE_INTEGER)) ||
              a.label.localeCompare(b.label, "es"),
          );
        widgets.by_shift = {
          rows,
          total: {
            shift: "",
            label: "Total",
            sessions: computed.length,
            orders: totalOrders,
            salesCents: totalSalesCents,
            percent: 100,
            expenseCents: totalExpenseCents,
            differenceCents: sum(closed.map((entry) => differenceOf(entry.row, entry.totals))),
          },
        };
      }

      if (can("stats.w.cash.by_method")) {
        const methodOf = (method: "cash" | "transfer", entry: (typeof computed)[number]) => {
          const totals = method === "cash" ? entry.totals.cash : entry.totals.transfer;
          return {
            orders: totals.salesCount,
            // The tips are part of the transfer side, as in the Cajas screen.
            salesCents: totals.salesCents + (method === "transfer" ? totals.tipCents : 0),
            incomeCents: totals.incomeCents ?? 0,
            expenseCents: totals.expenseCents ?? 0,
          };
        };
        const rows: CashMethodReportRow[] = (["cash", "transfer"] as const).map((method) => ({
          method,
          orders: sum(computed.map((entry) => methodOf(method, entry).orders)),
          salesCents: sum(computed.map((entry) => methodOf(method, entry).salesCents)),
          percent: 0,
          incomeCents: sum(computed.map((entry) => methodOf(method, entry).incomeCents)),
          expenseCents: sum(computed.map((entry) => methodOf(method, entry).expenseCents)),
        }));
        const visible =
          scoped.payment === "cash" || scoped.payment === "transfer"
            ? rows.filter((row) => row.method === scoped.payment)
            : rows;
        const salesCents = sum(visible.map((row) => row.salesCents ?? 0));
        const orders = sum(visible.map((row) => row.orders));
        widgets.by_method = {
          rows: visible.map((row) => ({
            ...row,
            percent: amounts ? percentage(row.salesCents ?? 0, salesCents) : percentage(row.orders, orders),
          })),
          total: {
            orders,
            salesCents,
            percent: 100,
            incomeCents: sum(visible.map((row) => row.incomeCents ?? 0)),
            expenseCents: sum(visible.map((row) => row.expenseCents ?? 0)),
          },
        };
      }

      if (can("stats.w.cash.movements")) {
        widgets.movements = groupCashMovements(
          manualRows
            .filter((group) => {
              if (scoped.payment === "cash") return group.cashCents > 0;
              if (scoped.payment === "transfer") return group.transferCents > 0;
              if (scoped.payment === "split") return group.cashCents > 0 && group.transferCents > 0;
              return true;
            })
            .map((group) => ({
              kind: group.kind,
              comment: group.comment,
              amountCents:
                scoped.payment === "cash"
                  ? group.cashCents
                  : scoped.payment === "transfer"
                    ? group.transferCents
                    : group.amountCents,
              createdAt: group.createdAt,
            })),
        );
      }

      if (can("stats.w.cash.sessions")) {
        const rows: CashSessionReportRow[] = computed.map((entry) => {
          const expected = entry.row.expectedCashCents ?? entry.totals.expectedCashCents;
          const counted = entry.row.countedCashCents ?? undefined;
          const difference = entry.row.closedAt !== null ? differenceOf(entry.row, entry.totals) : undefined;
          return {
            id: entry.row.id,
            openedAt: entry.row.openedAt.getTime(),
            closedAt: entry.row.closedAt?.getTime() ?? null,
            shift: entry.shift,
            shiftLabel: shiftLabels.get(entry.shift) ?? "Fuera de horario",
            openedByName: entry.row.openedByName,
            closedByName: entry.row.closedByName,
            orders: entry.totals.salesCount,
            salesCents: entry.totals.salesCents,
            expenseCents:
              (entry.totals.cash.expenseCents ?? 0) + (entry.totals.transfer.expenseCents ?? 0),
            expectedCashCents: expected ?? undefined,
            countedCashCents: counted,
            differenceCents: difference,
          };
        });
        widgets.sessions = rows;
      }

      const masked = can("cash.expected") ? widgets : maskCashReportWidgets(widgets);
      return {
        range,
        hasActivity: computed.length > 0 || Boolean(drawer?.session),
        widgets: amounts ? masked : withoutCents(masked),
      };
    },

    async meta(restaurantId: string): Promise<ReportMeta> {
      const restaurant = await assertPlan(restaurantId);
      const [slots, couriers] = await Promise.all([
        hours.listSlots(restaurantId),
        reports.courierOptions(restaurantId, now().getTime() - YEAR_MS),
      ]);
      return {
        shifts: shiftsFor(slots),
        couriers: couriers.map((courier) => ({
          memberId: courier.memberId,
          firstName: courier.firstName,
          lastName: courier.lastName,
        })),
        delivery: restaurant.delivery,
        takeaway: restaurant.takeaway,
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;

export function reportsServiceFor(db: D1Database): ReportsService {
  return createReportsService({
    reports: createReportsRepository(db),
    restaurants: createRestaurantsRepository(db),
    cash: createCashRepository(db),
    drawer: cashServiceFor(db),
    hours: createHoursRepository(db),
  });
}
