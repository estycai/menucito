import { hasPermission, type Access, type PermissionKey } from "@menucito/shared";
import { useMyRestaurant } from "./restaurant";

export interface AccessApi {
  /** What the API said about the signed-in member; `null` while the restaurant is loading. */
  access: Access | null;
  /** Whether the member has `key` (the owner has every key; an inactive member or role has none). */
  can: (key: PermissionKey) => boolean;
  /** `orders.settings`: the gear of "Ajustes de pedidos". */
  canEditOrderSettings: boolean;
  /** `orders.create`: the "Nuevo pedido" button. */
  canCreateOrders: boolean;
  /** The active owner of the restaurant: the only one who sees "Usuarios" and "Plan y pagos". */
  isOwner: boolean;
}

/** Pure core of `useAccess`, so the rules are testable without React. */
export function accessApi(access: Access | null | undefined): AccessApi {
  const current = access ?? null;
  const can = (key: PermissionKey) => (current ? hasPermission(current, key) : false);
  return {
    access: current,
    can,
    canEditOrderSettings: can("orders.settings"),
    canCreateOrders: can("orders.create"),
    isOwner: Boolean(current?.isOwner && current.active),
  };
}

/**
 * What the signed-in member may do. It comes from `GET /api/restaurants/me`, so it refreshes when the
 * tab regains focus and after a 403. The UI only hides what the API would refuse anyway.
 */
export function useAccess(): AccessApi {
  const { data: restaurant } = useMyRestaurant();
  return accessApi(restaurant?.access);
}
