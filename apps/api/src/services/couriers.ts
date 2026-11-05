import {
  localDateKey,
  localDayRange,
  type CourierOption,
  type CourierSummary,
  type CourierSummaryQuery,
  type CourierSummaryRow,
} from "@menucito/shared";
import { createMembersRepository, type MembersRepository } from "../repositories/members";
import { createOrdersRepository, type OrdersRepository } from "../repositories/orders";
import { ValidationError } from "./errors";

export interface CouriersDependencies {
  orders: OrdersRepository;
  members: MembersRepository;
  now?: () => Date;
}

/** Courier picker and daily summary of a local (decisions 11 and 13). */
export function createCouriersService({ orders, members, now = () => new Date() }: CouriersDependencies) {
  return {
    /** Active couriers of the local, with how many orders they have on the way (scenario 14). */
    async list(restaurantId: string): Promise<CourierOption[]> {
      return orders.listCouriers(restaurantId);
    },

    /** Orders of the range grouped by courier, by status (delivered, on the way or both), plus the totals (scenario 30). */
    async summary(restaurantId: string, query: CourierSummaryQuery): Promise<CourierSummary> {
      const today = localDateKey(now().getTime());
      const from = query.from ?? today;
      const to = query.to ?? today;
      const fromMs = localDayRange(from)[0];
      const toMs = localDayRange(to)[1];

      let courier: { firstName: string; lastName: string; active: boolean } | null = null;
      if (query.courierMemberId !== undefined) {
        const record = await members.find(restaurantId, query.courierMemberId);
        // A courier of another local or an unknown one is a 422 (decision 19).
        if (!record) throw new ValidationError("courierMemberId: elegí un repartidor de tu local");
        courier = { firstName: record.member.firstName, lastName: record.member.lastName, active: record.member.active };
      }

      const rows: CourierSummaryRow[] = await orders.courierSummary(restaurantId, fromMs, toMs, query.courierMemberId, query.status);
      // The page's filter options come from every courier of the local, not only the ones with
      // deliveries in the range, so a chosen courier never disappears after changing the dates.
      const couriers = await members.listCourierOptions(restaurantId);

      // Filtering by a courier always shows his row, even with no deliveries in the range.
      if (courier && query.courierMemberId !== undefined && !rows.some((row) => row.memberId === query.courierMemberId)) {
        rows.push({
          memberId: query.courierMemberId,
          firstName: courier.firstName,
          lastName: courier.lastName,
          active: courier.active,
          delivered: 0,
          inProgress: 0,
          shippingCents: 0,
          tipCents: 0,
        });
      }

      const totals = rows.reduce(
        (sum, row) => ({
          delivered: sum.delivered + row.delivered,
          inProgress: sum.inProgress + row.inProgress,
          shippingCents: sum.shippingCents + row.shippingCents,
          tipCents: sum.tipCents + row.tipCents,
        }),
        { delivered: 0, inProgress: 0, shippingCents: 0, tipCents: 0 },
      );

      return { from, to, couriers, rows, totals };
    },
  };
}

export type CouriersService = ReturnType<typeof createCouriersService>;

export function couriersServiceFor(db: D1Database): CouriersService {
  return createCouriersService({
    orders: createOrdersRepository(db),
    members: createMembersRepository(db),
  });
}
