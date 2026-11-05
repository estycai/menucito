import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { OrderSummary } from "@menucito/shared";
import { useAccess } from "./access";
import { ACTIVE_ORDERS_FILTERS, useOrders } from "./orders";
import { findNewOrders, newOrdersToast, type OrdersNavigationState } from "./new-orders";
import { useMyRestaurant } from "./restaurant";

/**
 * Turns each result of the active orders query into at most one toast. The seen ids accumulate
 * while the restaurant stays the same, so an order that comes back to the list (a failed
 * optimistic move rolled back) is not new; another restaurant (another account) starts over and
 * its first result announces nothing.
 */
export function createNewOrderNotifier() {
  let restaurantId: string | null = null;
  let seenIds: Set<string> | null = null;

  return function notify(
    currentRestaurantId: string,
    orders: ReadonlyArray<OrderSummary>,
    openOrders: (target: OrdersNavigationState) => void,
  ) {
    if (currentRestaurantId !== restaurantId) {
      restaurantId = currentRestaurantId;
      seenIds = null;
    }
    const content = newOrdersToast(findNewOrders(seenIds, orders));
    seenIds = new Set([...(seenIds ?? []), ...orders.map((order) => order.id)]);
    if (!content) return;

    toast(content.title, {
      description: content.description,
      action: { label: content.actionLabel, onClick: () => openOrders(content.target) },
    });
  };
}

/**
 * Polls the active orders from the admin shell, so a toast announces new orders on any screen
 * (spec 11b, decision 6). It shares the "Activos" board query (same cache key), so "Pedidos" does
 * not fetch twice.
 */
export function useNewOrderToasts() {
  const { data: restaurant } = useMyRestaurant();
  // A member without `orders.view` would only get 403s from this poll, so it does not run for them.
  const { can } = useAccess();
  const { data } = useOrders(ACTIVE_ORDERS_FILTERS, can("orders.view"));
  const navigate = useNavigate();
  const [notify] = useState(createNewOrderNotifier);
  const restaurantId = restaurant?.id;

  useEffect(() => {
    if (!restaurantId || !data) return;
    notify(restaurantId, data.orders, (target) => navigate("/pedidos", { state: target }));
  }, [restaurantId, data, navigate, notify]);
}
