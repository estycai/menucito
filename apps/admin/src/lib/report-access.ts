import { togglePermission } from "@/lib/permission-tree";
import {
  REPORT_FILTER_PERMISSIONS,
  REPORT_TABS,
  effectivePermissions,
  maskCashReportWidgets,
  percentage,
  withoutCents,
  type Access,
  type BillingReport,
  type BillingWidgets,
  type CashReport,
  type CashWidgets,
  type CouriersReport,
  type CouriersWidgets,
  type EvolutionReport,
  type EvolutionWidgets,
  type PermissionKey,
  type ReportFilterKey,
  type ReportFilters,
  type ReportTabKey,
  type Role,
  type SalesReport,
  type SalesWidgets,
} from "@menucito/shared";

/**
 * What a member sees in Reports, from the keys that actually count (`effectivePermissions`). The same
 * helpers clip the real page and the "Configurar vista" preview, so a preview matches the role's login.
 */

const keysOf = (access: Access) => new Set<string>(effectivePermissions(access));

/** Tabs of the catalog the role may open, in catalog order. */
export function visibleTabs(access: Access): ReportTabKey[] {
  const keys = keysOf(access);
  return REPORT_TABS.filter((tab) => keys.has(tab.key)).map((tab) => tab.key);
}

/** Filters the role may use, in catalog order. */
export function visibleFilters(access: Access): ReportFilterKey[] {
  const keys = keysOf(access);
  return REPORT_FILTER_PERMISSIONS.filter((filter) => keys.has(filter.key)).map((filter) => filter.key);
}

/** Widgets of `tab` the role sees, in catalog order. */
export function visibleWidgets(access: Access, tab: ReportTabKey): string[] {
  const keys = keysOf(access);
  const entry = REPORT_TABS.find((candidate) => candidate.key === tab);
  return (entry?.widgets ?? []).filter((widget) => keys.has(widget.key)).map((widget) => widget.key);
}

export function canSeeAmounts(access: Access): boolean {
  return keysOf(access).has("stats.amounts");
}

export function canExport(access: Access): boolean {
  return keysOf(access).has("stats.export");
}

/** The blind close of Cajas also applies in Reports (change 16c). */
export function canSeeCashExpected(access: Access): boolean {
  return keysOf(access).has("cash.expected");
}

/** The filters to send for `access`: a filter the role lacks is not applied (the API ignores it too). */
export function filtersForAccess(access: Access, filters: ReportFilters): ReportFilters {
  const available = new Set<string>(visibleFilters(access));
  const pick = (key: ReportFilterKey, value: string | undefined) => (available.has(key) ? value : undefined);
  return {
    from: pick("stats.f.date", filters.from),
    to: pick("stats.f.date", filters.to),
    shift: pick("stats.f.shift", filters.shift),
    fulfillment: available.has("stats.f.fulfillment") ? filters.fulfillment : undefined,
    payment: available.has("stats.f.payment") ? filters.payment : undefined,
    source: available.has("stats.f.source") ? filters.source : undefined,
    courier: pick("stats.f.courier", filters.courier),
  };
}

/**
 * The owner's report clipped to `access`, for the "Configurar vista" preview: only the widgets the role
 * has and, without amounts, no cents (the payment percentage falls back to the orders).
 */
export function clipEvolutionReport(report: EvolutionReport, access: Access): EvolutionReport {
  const allowed = new Set(visibleWidgets(access, "stats.tab.evolution"));
  const widgets: EvolutionWidgets = {};
  for (const [key, value] of Object.entries(report.widgets)) {
    if (allowed.has(`stats.w.evolution.${key}`)) (widgets as Record<string, unknown>)[key] = value;
  }
  if (!canSeeAmounts(access) && widgets.payment_methods) {
    const total = widgets.payment_methods.rows.reduce((sum, row) => sum + row.orders, 0);
    widgets.payment_methods = {
      ...widgets.payment_methods,
      rows: widgets.payment_methods.rows.map((row) => ({ ...row, percent: percentage(row.orders, total) })),
    };
  }
  return { ...report, widgets: canSeeAmounts(access) ? widgets : withoutCents(widgets) };
}

/** The owner's Billing report clipped to `access`, for the "Configurar vista" preview. */
export function clipBillingReport(report: BillingReport, access: Access): BillingReport {
  const allowed = new Set(visibleWidgets(access, "stats.tab.billing"));
  const amounts = canSeeAmounts(access);
  const widgets: BillingWidgets = {};
  const total = report.widgets.total;
  if (allowed.has("stats.w.billing.total") && total) {
    const orders = total.rows.reduce((sum, row) => sum + row.orders, 0);
    widgets.total = {
      ...total,
      rows: total.rows.map((row) => ({ ...row, percent: amounts ? row.percent : percentage(row.orders, orders) })),
    };
  }
  if (allowed.has("stats.w.billing.orders_total")) widgets.orders_total = report.widgets.orders_total;
  if (allowed.has("stats.w.billing.delivery")) widgets.delivery = report.widgets.delivery;
  if (allowed.has("stats.w.billing.takeaway")) widgets.takeaway = report.widgets.takeaway;
  const source = report.widgets.source;
  if (allowed.has("stats.w.billing.source") && source) {
    const orders = source.reduce((sum, row) => sum + row.orders, 0);
    widgets.source = source.map((row) => ({ ...row, percent: amounts ? row.percent : percentage(row.orders, orders) }));
  }
  return { ...report, widgets: amounts ? widgets : withoutCents(widgets) };
}

/** The owner's Sales report clipped to `access`, for the "Configurar vista" preview. */
export function clipSalesReport(report: SalesReport, access: Access): SalesReport {
  const allowed = new Set(visibleWidgets(access, "stats.tab.sales"));
  const amounts = canSeeAmounts(access);
  const widgets: SalesWidgets = {};
  if (allowed.has("stats.w.sales.top") && report.widgets.top) {
    widgets.top = amounts ? report.widgets.top : { byUnits: report.widgets.top.byUnits };
  }
  if (allowed.has("stats.w.sales.categories") && report.widgets.categories) {
    const units = report.widgets.categories.rows.reduce((sum, row) => sum + row.units, 0);
    widgets.categories = {
      total: report.widgets.categories.total,
      rows: report.widgets.categories.rows
        .map((row) => ({ ...row, percent: amounts ? row.percent : percentage(row.units, units) }))
        .sort((a, b) =>
          amounts
            ? (b.revenueCents ?? 0) - (a.revenueCents ?? 0) || a.category.localeCompare(b.category)
            : b.units - a.units || a.category.localeCompare(b.category),
        ),
    };
  }
  if (allowed.has("stats.w.sales.products")) widgets.products = report.widgets.products;
  if (allowed.has("stats.w.sales.addons")) widgets.addons = report.widgets.addons;
  return { ...report, widgets: amounts ? widgets : withoutCents(widgets) };
}

/** The owner's Couriers report clipped to `access`, for the "Configurar vista" preview. */
export function clipCouriersReport(report: CouriersReport, access: Access): CouriersReport {
  const allowed = new Set(visibleWidgets(access, "stats.tab.couriers"));
  const widgets: CouriersWidgets = {};
  for (const [key, value] of Object.entries(report.widgets)) {
    if (allowed.has(`stats.w.couriers.${key}`)) (widgets as Record<string, unknown>)[key] = value;
  }
  return { ...report, widgets: canSeeAmounts(access) ? widgets : withoutCents(widgets) };
}

/**
 * The owner's Arqueos report clipped to `access`, for the "Configurar vista" preview. Without
 * `cash.expected` the expected, the counted, the difference and the cash on hand disappear too.
 */
export function clipCashReport(report: CashReport, access: Access): CashReport {
  const allowed = new Set(visibleWidgets(access, "stats.tab.cash"));
  const widgets: CashWidgets = {};
  for (const [key, value] of Object.entries(report.widgets)) {
    if (allowed.has(`stats.w.cash.${key}`)) (widgets as Record<string, unknown>)[key] = value;
  }
  // The owner's report computed the percentages over money; without amounts they go over orders.
  if (!canSeeAmounts(access)) {
    if (widgets.by_shift) {
      const totalOrders = widgets.by_shift.total.orders;
      widgets.by_shift = {
        ...widgets.by_shift,
        rows: widgets.by_shift.rows.map((row) => ({ ...row, percent: percentage(row.orders, totalOrders) })),
      };
    }
    if (widgets.by_method) {
      const totalOrders = widgets.by_method.total.orders;
      widgets.by_method = {
        ...widgets.by_method,
        rows: widgets.by_method.rows.map((row) => ({ ...row, percent: percentage(row.orders, totalOrders) })),
      };
    }
  }
  const masked = canSeeCashExpected(access) ? widgets : maskCashReportWidgets(widgets);
  return { ...report, widgets: canSeeAmounts(access) ? masked : withoutCents(masked) };
}

/** A role as an `Access`, with `draft` as its permissions and an active role: the preview of Configurar vista. */
export function simulatedAccess(role: Pick<Role, "id" | "name">, draft: readonly PermissionKey[]): Access {
  return {
    memberId: "preview",
    isOwner: false,
    isCourier: false,
    active: true,
    role: { id: role.id, name: role.name, active: true },
    permissions: [...draft],
  };
}

/**
 * The eye of "Configurar vista": the same toggle as the roles tree, except that showing a tab again
 * when none of its blocks is left (hiding a tab drops its blocks) shows all of them, so the tab is not empty.
 */
export function toggleReportView(draft: readonly PermissionKey[], key: PermissionKey): PermissionKey[] {
  const next = togglePermission(draft, key);
  const tab = REPORT_TABS.find((entry) => entry.key === key);
  if (!tab || !next.includes(tab.key) || tab.widgets.some((widget) => next.includes(widget.key))) return next;
  return tab.widgets.reduce<PermissionKey[]>((keys, widget) => togglePermission(keys, widget.key), next);
}

/** "4 de 6" counters of the Configurar vista summary, from the draft keys (the blocks are those of `tab`). */
export function reportViewSummary(draft: readonly PermissionKey[], tab: ReportTabKey) {
  const keys = new Set<string>(draft);
  const entry = REPORT_TABS.find((candidate) => candidate.key === tab) ?? REPORT_TABS[0];
  const tabOn = keys.has(entry.key);
  return {
    tabs: { on: REPORT_TABS.filter((candidate) => keys.has(candidate.key)).length, total: REPORT_TABS.length },
    filters: { on: REPORT_FILTER_PERMISSIONS.filter((filter) => keys.has(filter.key)).length, total: REPORT_FILTER_PERMISSIONS.length },
    widgets: { on: tabOn ? entry.widgets.filter((widget) => keys.has(widget.key)).length : 0, total: entry.widgets.length },
  };
}
