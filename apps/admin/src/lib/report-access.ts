import { togglePermission } from "@/lib/permission-tree";
import {
  REPORT_FILTER_PERMISSIONS,
  REPORT_TABS,
  effectivePermissions,
  percentage,
  withoutCents,
  type Access,
  type EvolutionReport,
  type EvolutionWidgets,
  type PermissionKey,
  type ReportFilterKey,
  type ReportFilters,
  type ReportTabKey,
  type Role,
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
