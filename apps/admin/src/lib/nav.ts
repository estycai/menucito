export interface NavItem {
  id: string;
  label: string;
  to: string;
  /** Page title of the section. */
  title: string;
  /** Shows the "PRO" pill next to the label. */
  pro?: true;
}

/** Panel sections in the order of the design canvas. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "summary", label: "Resumen", to: "/", title: "Resumen" },
  { id: "menu", label: "Mi menú", to: "/menu", title: "Mi menú" },
  { id: "local", label: "Mi local", to: "/local", title: "Mi local" },
  { id: "qr", label: "Link y QR", to: "/qr", title: "Link y QR" },
  { id: "stats", label: "Estadísticas", to: "/estadisticas", title: "Estadísticas", pro: true },
  { id: "plan", label: "Plan y pagos", to: "/plan", title: "Plan y pagos" },
];

/**
 * The nav item that owns `pathname`, or `null`. `/` matches only exactly; every other item matches its
 * path or a sub-path on a segment boundary (`/menu/products/x` yes, `/menuX` no). A trailing slash is ignored.
 */
export function activeNavItem(pathname: string): NavItem | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  return (
    NAV_ITEMS.find((item) => (item.to === "/" ? path === "/" : path === item.to || path.startsWith(`${item.to}/`))) ??
    null
  );
}

export const documentTitle = (section: string) => `${section} · Menucito`;
