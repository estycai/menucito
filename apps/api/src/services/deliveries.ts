import { localDateKey, localDayRange, type CourierDelivery, type DateRangeQuery, type DeliverySummary } from "@menucito/shared";
import { createOrdersRepository, type OrdersRepository } from "../repositories/orders";
import { ConcurrentModificationError, InvalidTransitionError, OrderNotFoundError } from "./errors";

export interface DeliveriesDependencies {
  orders: OrdersRepository;
  now?: () => Date;
}

/**
 * "Mis repartos" (decision 10): the courier only sees and touches the orders assigned to him. The
 * courier and the restaurant come from the session (`requireCourier`), never from the request.
 */
export function createDeliveriesService({ orders, now = () => new Date() }: DeliveriesDependencies) {
  /** The local day range of the filter, both ends inclusive; absent means "today". */
  function range(query: DateRangeQuery): { from: string; to: string; fromMs: number; toMs: number } {
    const today = localDateKey(now().getTime());
    const from = query.from ?? today;
    const to = query.to ?? today;
    const [fromMs] = localDayRange(from);
    const [, toMs] = localDayRange(to);
    return { from, to, fromMs, toMs };
  }

  return {
    /** The courier's orders on the way, oldest first. */
    async list(restaurantId: string, courierMemberId: string): Promise<CourierDelivery[]> {
      return orders.listForCourier(restaurantId, courierMemberId);
    },

    /** The courier's own delivered orders of the range, with shipping and tips (scenario 29). */
    async summary(restaurantId: string, courierMemberId: string, query: DateRangeQuery): Promise<DeliverySummary> {
      const { from, to, fromMs, toMs } = range(query);
      const rows = await orders.courierSummary(restaurantId, fromMs, toMs, courierMemberId);
      const totals = rows.reduce(
        (sum, row) => ({
          delivered: sum.delivered + row.delivered,
          shippingCents: sum.shippingCents + row.shippingCents,
          tipCents: sum.tipCents + row.tipCents,
        }),
        { delivered: 0, shippingCents: 0, tipCents: 0 },
      );
      return { from, to, ...totals };
    },

    /**
     * Marks one of the courier's `sent` orders delivered. An order of another courier, of another
     * local or unknown is a 404 (decision 10: never reveal a stranger's order).
     */
    async markDelivered(restaurantId: string, courierMemberId: string, orderId: string) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current || current.courier?.memberId !== courierMemberId) throw new OrderNotFoundError();

      if (current.status !== "sent") throw new InvalidTransitionError();

      // A cash order is collected at the door, so delivering it marks it paid (decision 12).
      const updated = await orders.markDeliveredIf(
        restaurantId,
        orderId,
        "sent",
        { courierMemberId, markPaid: current.paymentMethod === "cash" },
        now(),
      );
      if (!updated) {
        const fresh = await orders.findDetail(restaurantId, orderId);
        if (fresh && fresh.status === "delivered") return fresh;
        throw new ConcurrentModificationError();
      }
      return updated;
    },
  };
}

export type DeliveriesService = ReturnType<typeof createDeliveriesService>;

export function deliveriesServiceFor(db: D1Database): DeliveriesService {
  return createDeliveriesService({ orders: createOrdersRepository(db) });
}
