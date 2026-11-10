import {
  ORDER_SOURCES,
  PAYMENT_SPLIT_NOTE,
  UNCATEGORIZED_LABEL,
  daysInRange,
  effectivePermissions,
  localDateKey,
  localDayRange,
  percentage,
  percentChange,
  planLimitsFor,
  previousRange,
  reportRange,
  reportRangeProblem,
  shiftsFor,
  yearBeforeRange,
  withoutCents,
  type BillingPaymentBlock,
  type BillingReport,
  type BillingSourceRow,
  type BillingWidgets,
  type EvolutionReport,
  type EvolutionWidgets,
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
import type { HoursRepository } from "../repositories/hours";
import type { OrdersRepository } from "../repositories/orders";
import {
  createReportsRepository,
  type BillingTotalsRow,
  type DailySeriesRow,
  type HourGridRow,
  type ReportsRepository,
  type ReportScope,
  type SalesSummaryRow,
} from "../repositories/reports";
import { createHoursRepository } from "../repositories/hours";
import { createOrdersRepository } from "../repositories/orders";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { PlanFeatureError, ReportRangeError, RestaurantNotFoundError } from "./errors";

export interface ReportsDependencies {
  reports: ReportsRepository;
  restaurants: RestaurantsRepository;
  orders: Pick<OrdersRepository, "listCouriers">;
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
  orders,
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
  async function reportContext(restaurantId: string, member: MemberContext, filters: ReportFilters) {
    const permissions = new Set<string>(effectivePermissions(member));
    const can = (key: string) => permissions.has(key);
    const range = reportRange(filters, can("stats.f.date"), now());
    const problem = reportRangeProblem(range);
    if (problem) throw new ReportRangeError(problem);

    const scoped: ReportFilters = {
      ...(can("stats.f.shift") && filters.shift ? { shift: filters.shift } : {}),
      ...(can("stats.f.fulfillment") && filters.fulfillment ? { fulfillment: filters.fulfillment } : {}),
      ...(can("stats.f.payment") && filters.payment ? { payment: filters.payment } : {}),
      ...(can("stats.f.source") && filters.source ? { source: filters.source } : {}),
      ...(can("stats.f.courier") && filters.courier ? { courier: filters.courier } : {}),
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

    async meta(restaurantId: string): Promise<ReportMeta> {
      const restaurant = await assertPlan(restaurantId);
      const [slots, couriers] = await Promise.all([hours.listSlots(restaurantId), orders.listCouriers(restaurantId)]);
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
    orders: createOrdersRepository(db),
    hours: createHoursRepository(db),
  });
}
