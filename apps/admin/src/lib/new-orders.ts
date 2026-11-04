import { useEffect, useRef, useState } from "react";

/**
 * Orders in `orders` that were not in `prevIds`. `null` means "first load": what is already there
 * is not new, but the very first order arriving on an empty board is (scenario 41).
 */
export function countNewOrders(prevIds: ReadonlySet<string> | null, orders: ReadonlyArray<{ id: string }>): number {
  if (prevIds === null) return 0;
  return orders.filter((order) => !prevIds.has(order.id)).length;
}

/** Screen reader message for `count` new orders, or `null` when there are none. */
export function newOrdersMessage(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Llegó 1 pedido nuevo" : `Llegaron ${count} pedidos nuevos`;
}

/** Text for an `aria-live` region that announces orders arriving on the board between refreshes. */
export function useNewOrderAnnouncer(orders: ReadonlyArray<{ id: string }> | undefined): string | null {
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const prevIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!orders) return;
    const message = newOrdersMessage(countNewOrders(prevIdsRef.current, orders));
    if (message) setAnnouncement(message);
    prevIdsRef.current = new Set(orders.map((order) => order.id));
  }, [orders]);

  return announcement;
}
