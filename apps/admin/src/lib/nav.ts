import type { Access, PermissionKey } from "@menucito/shared";
import { accessApi } from "./access";

export interface NavItem {
  id: string;
  label: string;
  to: string;
  /** Page title of the section. */
  title: string;
  /** Shows the "PRO" pill next to the label. */
  pro?: true;
  /** The `<section>.view` key a member needs to see the section. */
  permission?: PermissionKey;
  /** Only the owner sees it; it is not a permission anyone can be given. */
  ownerOnly?: true;
  /** Only a member marked as a courier sees it (change 13): the mark, not a permission, enables it. */
  courierOnly?: true;
}

/** Panel sections in the order of the design canvas ("Usuarios" goes after "Mi local", spec 12). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "summary", label: "Resumen", to: "/", title: "Resumen", permission: "summary.view" },
  { id: "orders", label: "Pedidos", to: "/pedidos", title: "Pedidos", permission: "orders.view" },
  { id: "cash", label: "Cajas", to: "/cajas", title: "Cajas", permission: "cash.view" },
  { id: "couriers", label: "Repartidores", to: "/repartidores", title: "Repartidores", permission: "couriers.view" },
  { id: "deliveries", label: "Mis repartos", to: "/mis-repartos", title: "Mis repartos", courierOnly: true },
  { id: "menu", label: "Mi menú", to: "/menu", title: "Mi menú", permission: "menu.view" },
  { id: "local", label: "Mi local", to: "/local", title: "Mi local", permission: "store.view" },
  { id: "users", label: "Usuarios", to: "/usuarios", title: "Usuarios", ownerOnly: true },
  { id: "stats", label: "Reportes", to: "/reportes", title: "Reportes", pro: true, permission: "stats.view" },
  { id: "plan", label: "Plan y pagos", to: "/plan", title: "Plan y pagos", ownerOnly: true },
];

/** Whether `access` may open `item`: owner-only items need the owner, the others their `.view` key. */
export function canSeeNavItem(item: NavItem, access: Access | null | undefined): boolean {
  const { can, isOwner } = accessApi(access);
  if (item.ownerOnly) return isOwner;
  // The courier section follows the `is_courier` mark, on top of whatever the role's permissions grant.
  if (item.courierOnly) return Boolean(access?.active && access.isCourier);
  return item.permission ? can(item.permission) : true;
}

/** The sections of the menu the member may open, in menu order. Empty while `access` is unknown. */
export function visibleNavItems(access: Access | null | undefined): NavItem[] {
  return access ? NAV_ITEMS.filter((item) => canSeeNavItem(item, access)) : [];
}

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
