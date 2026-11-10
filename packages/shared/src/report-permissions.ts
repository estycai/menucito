import type { PermissionDefinition, PermissionKey, PermissionSection } from "./permissions";

/**
 * Catalog of the Reports permissions (change 16a). Every key hangs from `stats.view` and the widgets
 * hang from their tab, so the same tree feeds the roles editor, the access helpers and the API.
 * The widgets of the tabs of 16b and 16c are declared here too: the catalog is complete from day one.
 */

export const REPORT_GENERAL_PERMISSIONS = [
  { key: "stats.amounts", label: "Ver montos en $" },
  { key: "stats.export", label: "Exportar a CSV" },
] as const;

export const REPORT_FILTER_PERMISSIONS = [
  { key: "stats.f.date", label: "Fecha" },
  { key: "stats.f.shift", label: "Turno" },
  { key: "stats.f.fulfillment", label: "Modalidad" },
  { key: "stats.f.payment", label: "Medio de pago" },
  { key: "stats.f.source", label: "Origen" },
  { key: "stats.f.courier", label: "Repartidor" },
] as const;

export const REPORT_TABS = [
  {
    key: "stats.tab.evolution",
    label: "Evolución",
    widgets: [
      { key: "stats.w.evolution.billed", label: "Facturado" },
      { key: "stats.w.evolution.orders", label: "Pedidos" },
      { key: "stats.w.evolution.ticket", label: "Ticket promedio" },
      { key: "stats.w.evolution.shipping", label: "Envíos cobrados" },
      { key: "stats.w.evolution.discounts", label: "Descuentos" },
      { key: "stats.w.evolution.cancellations", label: "Cancelaciones" },
      { key: "stats.w.evolution.pnl", label: "Cuenta de resultados" },
      { key: "stats.w.evolution.pace", label: "Ritmo del negocio" },
      { key: "stats.w.evolution.trend", label: "Evolución de ventas" },
      { key: "stats.w.evolution.heatmap", label: "Día y hora" },
      { key: "stats.w.evolution.movers", label: "Productos en alza y en baja" },
      { key: "stats.w.evolution.payment_methods", label: "Medios de pago" },
      { key: "stats.w.evolution.customers", label: "Clientes recurrentes" },
    ],
  },
  {
    key: "stats.tab.billing",
    label: "Facturación",
    widgets: [
      { key: "stats.w.billing.total", label: "Facturación total por medio" },
      { key: "stats.w.billing.orders_total", label: "Pedidos por modalidad" },
      { key: "stats.w.billing.delivery", label: "Delivery por medio de pago" },
      { key: "stats.w.billing.takeaway", label: "Take away por medio de pago" },
      { key: "stats.w.billing.source", label: "Pedidos por origen" },
    ],
  },
  {
    key: "stats.tab.sales",
    label: "Ventas",
    widgets: [
      { key: "stats.w.sales.top", label: "Top 10 de productos" },
      { key: "stats.w.sales.categories", label: "Ventas por categoría" },
      { key: "stats.w.sales.products", label: "Productos" },
      { key: "stats.w.sales.addons", label: "Adicionales" },
    ],
  },
  {
    key: "stats.tab.couriers",
    label: "Repartidores",
    widgets: [
      { key: "stats.w.couriers.orders", label: "Envíos" },
      { key: "stats.w.couriers.shipping", label: "Envíos cobrados" },
      { key: "stats.w.couriers.tips", label: "Propinas" },
      { key: "stats.w.couriers.time", label: "Tiempo de entrega" },
      { key: "stats.w.couriers.by_courier", label: "Por repartidor" },
      { key: "stats.w.couriers.by_zone", label: "Envíos por zona" },
    ],
  },
  {
    key: "stats.tab.cash",
    label: "Arqueos",
    widgets: [
      { key: "stats.w.cash.open", label: "Caja abierta ahora" },
      { key: "stats.w.cash.kpis", label: "Indicadores" },
      { key: "stats.w.cash.by_shift", label: "Por turno" },
      { key: "stats.w.cash.by_method", label: "Por medio de pago" },
      { key: "stats.w.cash.movements", label: "Movimientos" },
      { key: "stats.w.cash.sessions", label: "Arqueos" },
    ],
  },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];
export type ReportTabKey = ReportTab["key"];
export type ReportWidgetKey = ReportTab["widgets"][number]["key"];
export type ReportGeneralKey = (typeof REPORT_GENERAL_PERMISSIONS)[number]["key"];
export type ReportFilterKey = (typeof REPORT_FILTER_PERMISSIONS)[number]["key"];

/**
 * The filters each tab shows and applies (change 16c). A filter without permission never appears;
 * the URL keeps it anyway, so it applies again when the member goes back to a tab that uses it.
 */
export const TAB_FILTERS: Readonly<Record<ReportTabKey, readonly ReportFilterKey[]>> = {
  "stats.tab.evolution": REPORT_FILTER_PERMISSIONS.map((filter) => filter.key),
  "stats.tab.billing": REPORT_FILTER_PERMISSIONS.map((filter) => filter.key),
  "stats.tab.sales": REPORT_FILTER_PERMISSIONS.map((filter) => filter.key),
  // Delivery has a courier; the take away has none.
  "stats.tab.couriers": ["stats.f.date", "stats.f.shift", "stats.f.payment", "stats.f.source", "stats.f.courier"],
  // The cash drawer only knows dates, shifts and methods.
  "stats.tab.cash": ["stats.f.date", "stats.f.shift", "stats.f.payment"],
};

/** The section as it appears in the permission catalog: general, filters and the tabs with their widgets. */
export const REPORTS_SECTION = {
  key: "stats.view",
  label: "Reportes",
  subpermissions: [
    ...REPORT_GENERAL_PERMISSIONS,
    ...REPORT_FILTER_PERMISSIONS,
    ...REPORT_TABS.map((tab) => ({ key: tab.key, label: tab.label, children: tab.widgets })),
  ],
} as const satisfies PermissionSection;

/** Every key of the Reports tree, `stats.view` first. */
export const REPORT_PERMISSION_KEYS: readonly PermissionKey[] = [
  "stats.view",
  ...REPORT_GENERAL_PERMISSIONS.map((entry) => entry.key),
  ...REPORT_FILTER_PERMISSIONS.map((entry) => entry.key),
  ...REPORT_TABS.flatMap((tab) => [tab.key, ...tab.widgets.map((widget) => widget.key)]),
] as PermissionKey[];

/** The 47 keys a role with `stats.view` receives in migration 0017. */
export const GRANTED_REPORT_PERMISSION_KEYS: readonly PermissionKey[] = REPORT_PERMISSION_KEYS.filter(
  (key) => key !== "stats.view",
);

const TAB_BY_KEY = new Map(REPORT_TABS.map((tab) => [tab.key as string, tab]));

/** Whether `key` belongs to the Reports tree (`stats.view` included). */
export function isReportPermission(key: string): boolean {
  return key === "stats.view" || key.startsWith("stats.");
}

/**
 * Parent of a Reports key: a widget hangs from its tab and a tab, a filter or a general key from
 * `stats.view`. Returns `undefined` for keys outside Reports, so `parentOf` falls back to the section.
 */
export function reportParentOf(key: string): PermissionKey | undefined {
  if (key === "stats.view" || !key.startsWith("stats.")) return undefined;
  for (const tab of REPORT_TABS) {
    if (tab.widgets.some((widget) => widget.key === key)) return tab.key;
  }
  return "stats.view";
}

/** The label of a tab or widget key, for the role editor and the "Configurar vista" screen. */
export function reportPermissionLabel(key: string): string | undefined {
  if (key === "stats.view") return "Reportes";
  for (const entry of [...REPORT_GENERAL_PERMISSIONS, ...REPORT_FILTER_PERMISSIONS]) {
    if (entry.key === key) return entry.label;
  }
  const tab = TAB_BY_KEY.get(key);
  if (tab) return tab.label;
  for (const candidate of REPORT_TABS) {
    const widget = candidate.widgets.find((entry) => entry.key === key);
    if (widget) return widget.label;
  }
  return undefined;
}

/** The blocks of a tab, in display order. */
export function reportWidgetsOf(tab: ReportTabKey): readonly PermissionDefinition[] {
  return TAB_BY_KEY.get(tab)?.widgets ?? [];
}
