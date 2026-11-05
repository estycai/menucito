import { and, asc, desc, eq, gte, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  ACTIVE_ORDER_STATUSES,
  type AddressLabel,
  type CourierDelivery,
  type CourierOption,
  type CourierSummaryRow,
  type CourierSummaryStatus,
  type Fulfillment,
  type OrderCourier,
  type OrderDateField,
  type OrderDeliveryLocation,
  type OrderDetail,
  type OrderItem,
  type OrderItemOption,
  type OrderStatus,
  type OrderStatusFilter,
  type OrderSummary,
  type PaymentMethod,
  type PaymentStatus,
} from "@menucito/shared";
import {
  customerAddresses,
  customers,
  orderItems,
  orders,
  restaurantMembers,
  type OrderDbRow,
  type OrderItemDbRow,
} from "../db/schema";
import { translatingUniqueViolations } from "./errors";

/** D1 caps bound parameters per statement at 100; keep `IN (...)` lists below it. */
const ITEMS_QUERY_CHUNK = 90;

/** Geocoded address of a delivery priced by zones, and the zone that priced it. */
export interface InsertOrderDelivery {
  /** Id of the `customer_addresses` row, used only if the customer never used this address before. */
  addressId: string;
  lat: number;
  lng: number;
  placeId: string | null;
  formattedAddress: string;
  locality: string | null;
  unit: string | null;
  betweenStreets: string | null;
  label: AddressLabel | null;
  zoneId: string;
  zoneName: string;
  distanceM: number;
}

export interface InsertOrderData {
  orderId: string;
  restaurantId: string;
  clientToken: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  /** Set for delivery orders of stores in `zones` mode; the address is also saved for the customer. */
  delivery: InsertOrderDelivery | null;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  subtotalCents: number;
  shippingCents: number;
  tipCents: number;
  totalCents: number;
  createdAt: Date;
  items: {
    id: string;
    productId: string | null;
    position: number;
    name: string;
    unitPriceCents: number;
    quantity: number;
    optionsJson: string | null;
  }[];
}

export interface ListOrdersFilter {
  limit?: number;
  before?: number; // order number cursor
  status?: OrderStatusFilter;
  fulfillment?: Fulfillment;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  fromMs?: number;
  toMs?: number;
  /** Column `fromMs`/`toMs` apply to; `created` when absent. */
  dateField?: OrderDateField;
}

export interface OrdersRepository {
  /**
   * Inserts the customer (deduplicated by phone), the order and its items in one batch; a geocoded
   * delivery address is also saved (or refreshed) among the customer's addresses. Throws
   * `UniqueViolationError` whose `columns` include `client_token` (token already used) or `number`
   * (a concurrent order took the number).
   */
  insertOrder(data: InsertOrderData): Promise<OrderDetail>;
  findByToken(restaurantId: string, clientToken: string): Promise<OrderDetail | null>;
  findDetail(restaurantId: string, orderId: string): Promise<OrderDetail | null>;
  countRecentByPhone(restaurantId: string, phone: string, since: Date): Promise<number>;
  list(restaurantId: string, filter: ListOrdersFilter): Promise<{ orders: OrderSummary[]; nextBefore: number | null }>;
  /** Newest first, at most `limit` orders with their items. */
  listForExport(restaurantId: string, filter: ListOrdersFilter, limit: number): Promise<OrderDetail[]>;
  updateStatusIf(
    restaurantId: string,
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    updatedAt: Date,
  ): Promise<OrderDetail | null>;
  updatePaymentStatus(
    restaurantId: string,
    orderId: string,
    paymentStatus: PaymentStatus,
    updatedAt: Date,
  ): Promise<OrderDetail | null>;
  /**
   * Assigns `courierMemberId` to a delivery order that is `ready` or `sent`. From `ready` it also
   * becomes `sent` and stamps `sent_at`; from `sent` the timestamp is kept. `null` when the order was
   * not in `fromStatus` anymore (a simultaneous change won).
   */
  assignCourierIf(
    restaurantId: string,
    orderId: string,
    courierMemberId: string,
    fromStatus: "ready" | "sent",
    at: Date,
  ): Promise<OrderDetail | null>;
  /**
   * Passes an order from `fromStatus` to `delivered`, stamps `delivered_at` and marks cash orders
   * paid. With `courierMemberId`, only that courier's orders match (the courier's own delivery).
   */
  markDeliveredIf(
    restaurantId: string,
    orderId: string,
    fromStatus: OrderStatus,
    options: { courierMemberId?: string; markPaid: boolean },
    at: Date,
  ): Promise<OrderDetail | null>;
  /** The orders a courier has on the way (`sent`), oldest first. */
  listForCourier(restaurantId: string, courierMemberId: string): Promise<CourierDelivery[]>;
  /**
   * Orders in `[fromMs, toMs)` grouped by courier, with their shipping and tips: delivered ones by
   * `delivered_at`, on-the-way ones by `sent_at`, as `status` asks. The "Sin repartidor" row comes as
   * `memberId: null`; cancelled orders never count.
   */
  courierSummary(
    restaurantId: string,
    fromMs: number,
    toMs: number,
    courierMemberId?: string,
    status?: CourierSummaryStatus,
  ): Promise<CourierSummaryRow[]>;
  /** How many orders, in any status, are assigned to a member (deleting it would lose history). */
  countByCourier(restaurantId: string, courierMemberId: string): Promise<number>;
  /** Active couriers of the local, by name, with how many orders they have `sent` right now. */
  listCouriers(restaurantId: string): Promise<CourierOption[]>;
}

export function createOrdersRepository(d1: D1Database): OrdersRepository {
  const db = drizzle(d1);

  function toOrderItem(row: OrderItemDbRow): OrderItem {
    let options: OrderItemOption[] | null = null;
    if (row.optionsJson) {
      try {
        options = JSON.parse(row.optionsJson) as OrderItemOption[];
      } catch {
        options = null;
      }
    }
    return {
      id: row.id,
      orderId: row.orderId,
      productId: row.productId,
      position: row.position,
      name: row.name,
      unitPriceCents: row.unitPriceCents,
      quantity: row.quantity,
      options,
      notes: row.notes,
    };
  }

  function toDeliveryLocation(row: OrderDbRow): OrderDeliveryLocation | null {
    if (row.deliveryLat === null || row.deliveryLng === null) return null;
    return {
      lat: row.deliveryLat,
      lng: row.deliveryLng,
      placeId: row.deliveryPlaceId,
      unit: row.deliveryUnit,
      betweenStreets: row.deliveryBetweenStreets,
      label: row.deliveryLabel as AddressLabel | null,
      zoneName: row.deliveryZoneName,
      distanceM: row.deliveryDistanceM,
    };
  }

  function toOrderDetail(orderRow: OrderDbRow, itemRows: OrderItemDbRow[], courier: OrderCourier | null): OrderDetail {
    return {
      id: orderRow.id,
      number: orderRow.number,
      status: orderRow.status as OrderStatus,
      paymentStatus: orderRow.paymentStatus as PaymentStatus,
      fulfillment: orderRow.fulfillment as Fulfillment,
      paymentMethod: orderRow.paymentMethod as PaymentMethod,
      customerName: orderRow.customerName,
      customerPhone: orderRow.customerPhone,
      deliveryAddress: orderRow.deliveryAddress,
      deliveryLocation: toDeliveryLocation(orderRow),
      notes: orderRow.notes,
      subtotalCents: orderRow.subtotalCents,
      shippingCents: orderRow.shippingCents,
      discountCents: orderRow.discountCents,
      tipCents: orderRow.tipCents,
      totalCents: orderRow.totalCents,
      items: itemRows.map(toOrderItem),
      createdAt: orderRow.createdAt.getTime(),
      updatedAt: orderRow.updatedAt.getTime(),
      courier,
      sentAt: orderRow.sentAt?.getTime() ?? null,
      deliveredAt: orderRow.deliveredAt?.getTime() ?? null,
    };
  }

  /** The courier a member id points to, or `null` (takeaway, not sent yet, older orders). */
  async function courierOf(memberId: string | null): Promise<OrderCourier | null> {
    if (!memberId) return null;
    const row = await db
      .select({ firstName: restaurantMembers.firstName, lastName: restaurantMembers.lastName })
      .from(restaurantMembers)
      .where(eq(restaurantMembers.id, memberId))
      .get();
    return row ? { memberId, firstName: row.firstName, lastName: row.lastName } : null;
  }

  /** Couriers of many orders in a few queries, chunked like the items. */
  async function couriersById(memberIds: string[]): Promise<Map<string, OrderCourier>> {
    const byId = new Map<string, OrderCourier>();
    for (let start = 0; start < memberIds.length; start += ITEMS_QUERY_CHUNK) {
      const chunk = memberIds.slice(start, start + ITEMS_QUERY_CHUNK);
      if (chunk.length === 0) continue;
      const rows = await db
        .select({ id: restaurantMembers.id, firstName: restaurantMembers.firstName, lastName: restaurantMembers.lastName })
        .from(restaurantMembers)
        .where(inArray(restaurantMembers.id, chunk))
        .all();
      for (const row of rows) byId.set(row.id, { memberId: row.id, firstName: row.firstName, lastName: row.lastName });
    }
    return byId;
  }

  function toCourierDelivery(row: OrderDbRow): CourierDelivery {
    return {
      id: row.id,
      number: row.number,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      deliveryAddress: row.deliveryAddress,
      deliveryLocation: toDeliveryLocation(row),
      notes: row.notes,
      paymentMethod: row.paymentMethod as PaymentMethod,
      totalCents: row.totalCents,
      shippingCents: row.shippingCents,
      tipCents: row.tipCents,
      sentAt: row.sentAt?.getTime() ?? null,
    };
  }

  async function getOrderDetail(orderRow: OrderDbRow): Promise<OrderDetail> {
    const [itemRows, courier] = await Promise.all([
      db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderRow.id))
        .orderBy(orderItems.position)
        .all(),
      courierOf(orderRow.courierMemberId),
    ]);
    return toOrderDetail(orderRow, itemRows, courier);
  }

  async function findDetail(restaurantId: string, orderId: string): Promise<OrderDetail | null> {
    const row = await db
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .get();

    return row ? getOrderDetail(row) : null;
  }

  /** Items of many orders in a few queries, chunked to stay under D1's bound-parameter limit. */
  async function itemsByOrderId(orderIds: string[]): Promise<Map<string, OrderItemDbRow[]>> {
    const byOrder = new Map<string, OrderItemDbRow[]>();
    for (let start = 0; start < orderIds.length; start += ITEMS_QUERY_CHUNK) {
      const chunk = orderIds.slice(start, start + ITEMS_QUERY_CHUNK);
      const rows = await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, chunk))
        .orderBy(orderItems.orderId, orderItems.position)
        .all();
      for (const row of rows) {
        const list = byOrder.get(row.orderId) ?? [];
        list.push(row);
        byOrder.set(row.orderId, list);
      }
    }
    return byOrder;
  }

  function buildFilterConditions(restaurantId: string, filter: ListOrdersFilter) {
    const conditions = [eq(orders.restaurantId, restaurantId)];

    if (filter.before !== undefined) {
      conditions.push(lt(orders.number, filter.before));
    }

    if (filter.status !== undefined) {
      if (filter.status === "active") {
        conditions.push(inArray(orders.status, [...ACTIVE_ORDER_STATUSES]));
      } else {
        conditions.push(eq(orders.status, filter.status));
      }
    }

    if (filter.fulfillment !== undefined) {
      conditions.push(eq(orders.fulfillment, filter.fulfillment));
    }

    if (filter.paymentMethod !== undefined) {
      conditions.push(eq(orders.paymentMethod, filter.paymentMethod));
    }

    if (filter.paymentStatus !== undefined) {
      conditions.push(eq(orders.paymentStatus, filter.paymentStatus));
    }

    const dateColumn =
      filter.dateField === "updated" ? orders.updatedAt : filter.dateField === "delivered" ? orders.deliveredAt : orders.createdAt;

    if (filter.fromMs !== undefined) {
      conditions.push(gte(dateColumn, new Date(filter.fromMs)));
    }

    if (filter.toMs !== undefined) {
      conditions.push(lt(dateColumn, new Date(filter.toMs)));
    }

    return and(...conditions);
  }

  /**
   * Upsert of the address among the customer's: the same place (or, without a place id, the same text
   * and unit) is refreshed, anything else is added. `customer_addresses` has no unique key to upsert
   * on, so it is an UPDATE plus an INSERT ... SELECT guarded by NOT EXISTS, both inside the order's
   * batch (one transaction). The customer is found like the order finds it, by restaurant and phone.
   */
  function saveCustomerAddress(data: InsertOrderData, address: InsertOrderDelivery) {
    const customerId = sql<string>`(SELECT id FROM customers WHERE restaurant_id = ${data.restaurantId} AND phone = ${data.customerPhone})`;
    const sameAddress = address.placeId
      ? eq(customerAddresses.placeId, address.placeId)
      : and(eq(customerAddresses.formattedAddress, address.formattedAddress), sql`${customerAddresses.unit} IS ${address.unit}`);
    const usedAt = data.createdAt;
    const fields = {
      formattedAddress: address.formattedAddress,
      locality: address.locality,
      lat: address.lat,
      lng: address.lng,
      placeId: address.placeId,
      betweenStreets: address.betweenStreets,
      unit: address.unit,
    };

    return [
      db
        .update(customerAddresses)
        // An address used again without a label keeps the one it had.
        .set({ ...fields, label: sql`COALESCE(${address.label}, ${customerAddresses.label})`, lastUsedAt: usedAt })
        .where(and(eq(customerAddresses.customerId, customerId), sameAddress)),
      db
        .insert(customerAddresses)
        .select(
          db
            .select({
              id: sql<string>`${address.addressId}`.as("id"),
              restaurantId: customers.restaurantId,
              customerId: customers.id,
              label: sql<string | null>`${address.label}`.as("label"),
              formattedAddress: sql<string>`${address.formattedAddress}`.as("formatted_address"),
              locality: sql<string | null>`${address.locality}`.as("locality"),
              lat: sql<number>`${address.lat}`.as("lat"),
              lng: sql<number>`${address.lng}`.as("lng"),
              placeId: sql<string | null>`${address.placeId}`.as("place_id"),
              betweenStreets: sql<string | null>`${address.betweenStreets}`.as("between_streets"),
              unit: sql<string | null>`${address.unit}`.as("unit"),
              createdAt: sql<Date>`${usedAt.getTime()}`.as("created_at"),
              lastUsedAt: sql<Date>`${usedAt.getTime()}`.as("last_used_at"),
            })
            .from(customers)
            .where(
              and(
                eq(customers.restaurantId, data.restaurantId),
                eq(customers.phone, data.customerPhone),
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(customerAddresses)
                    .where(and(eq(customerAddresses.customerId, customers.id), sameAddress)),
                ),
              ),
            ),
        ),
    ];
  }

  return {
    async insertOrder(data) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const batchStatements: BatchStatement[] = [
        db
          .insert(customers)
          .values({
            id: data.customerId,
            restaurantId: data.restaurantId,
            name: data.customerName,
            phone: data.customerPhone,
            address: data.deliveryAddress,
            firstOrderAt: data.createdAt,
            createdAt: data.createdAt,
            updatedAt: data.createdAt,
          })
          .onConflictDoNothing(),
        db.insert(orders).values({
          id: data.orderId,
          restaurantId: data.restaurantId,
          customerId: sql`(SELECT id FROM customers WHERE restaurant_id = ${data.restaurantId} AND phone = ${data.customerPhone})`,
          number: sql`(SELECT COALESCE(MAX(number), 0) + 1 FROM orders WHERE restaurant_id = ${data.restaurantId})`,
          clientToken: data.clientToken,
          status: "new",
          paymentStatus: "pending",
          fulfillment: data.fulfillment,
          paymentMethod: data.paymentMethod,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          deliveryAddress: data.deliveryAddress,
          deliveryLat: data.delivery?.lat ?? null,
          deliveryLng: data.delivery?.lng ?? null,
          deliveryPlaceId: data.delivery?.placeId ?? null,
          deliveryUnit: data.delivery?.unit ?? null,
          deliveryBetweenStreets: data.delivery?.betweenStreets ?? null,
          deliveryLabel: data.delivery?.label ?? null,
          deliveryZoneId: data.delivery?.zoneId ?? null,
          deliveryZoneName: data.delivery?.zoneName ?? null,
          deliveryDistanceM: data.delivery?.distanceM ?? null,
          subtotalCents: data.subtotalCents,
          shippingCents: data.shippingCents,
          discountCents: 0,
          tipCents: data.tipCents,
          totalCents: data.totalCents,
          createdAt: data.createdAt,
          updatedAt: data.createdAt,
        }),
      ];

      for (const item of data.items) {
        batchStatements.push(
          db.insert(orderItems).values({
            id: item.id,
            orderId: data.orderId,
            productId: item.productId,
            position: item.position,
            name: item.name,
            unitPriceCents: item.unitPriceCents,
            quantity: item.quantity,
            optionsJson: item.optionsJson,
          }),
        );
      }

      if (data.delivery) batchStatements.push(...saveCustomerAddress(data, data.delivery));

      await translatingUniqueViolations(() =>
        db.batch(batchStatements as [BatchStatement, ...BatchStatement[]]),
      );

      const created = await findDetail(data.restaurantId, data.orderId);
      if (!created) throw new Error("Order disappeared right after insert");
      return created;
    },

    async findByToken(restaurantId, clientToken) {
      const row = await db
        .select()
        .from(orders)
        .where(and(eq(orders.restaurantId, restaurantId), eq(orders.clientToken, clientToken)))
        .get();

      if (!row) return null;
      return getOrderDetail(row);
    },

    findDetail,

    async countRecentByPhone(restaurantId, phone, since) {
      const res = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.customerPhone, phone),
            gte(orders.createdAt, since),
          ),
        )
        .get();

      return Number(res?.count ?? 0);
    },

    async list(restaurantId, filter) {
      const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
      const whereCondition = buildFilterConditions(restaurantId, filter);

      const rows = await db
        .select({
          order: orders,
          itemCount: sql<number>`(SELECT count(*) FROM order_items WHERE order_items.order_id = orders.id)`,
          courierFirstName: restaurantMembers.firstName,
          courierLastName: restaurantMembers.lastName,
        })
        .from(orders)
        .leftJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(whereCondition)
        .orderBy(desc(orders.number))
        .limit(limit + 1)
        .all();

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;

      const orderSummaries: OrderSummary[] = sliced.map(({ order, itemCount, courierFirstName, courierLastName }) => ({
        id: order.id,
        number: order.number,
        status: order.status as OrderStatus,
        paymentStatus: order.paymentStatus as PaymentStatus,
        fulfillment: order.fulfillment as Fulfillment,
        paymentMethod: order.paymentMethod as PaymentMethod,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        totalCents: order.totalCents,
        itemCount: Number(itemCount),
        createdAt: order.createdAt.getTime(),
        courier:
          order.courierMemberId && courierFirstName
            ? { memberId: order.courierMemberId, firstName: courierFirstName, lastName: courierLastName ?? "" }
            : null,
        deliveryLocation:
          order.deliveryLat === null || order.deliveryLng === null
            ? null
            : { lat: order.deliveryLat, lng: order.deliveryLng, zoneName: order.deliveryZoneName },
      }));

      const last = sliced[sliced.length - 1];
      const nextBefore = hasMore && last ? last.order.number : null;

      return { orders: orderSummaries, nextBefore };
    },

    async listForExport(restaurantId, filter, limit) {
      const whereCondition = buildFilterConditions(restaurantId, filter);
      const rows = await db
        .select()
        .from(orders)
        .where(whereCondition)
        .orderBy(desc(orders.number))
        .limit(limit)
        .all();

      const items = await itemsByOrderId(rows.map((row) => row.id));
      const courierIds = [
        ...new Set(rows.map((row) => row.courierMemberId).filter((id): id is string => id !== null)),
      ];
      const couriers = await couriersById(courierIds);
      return rows.map((row) =>
        toOrderDetail(row, items.get(row.id) ?? [], row.courierMemberId ? couriers.get(row.courierMemberId) ?? null : null),
      );
    },

    async updateStatusIf(restaurantId, orderId, fromStatus, toStatus, updatedAt) {
      const updated = await db
        .update(orders)
        .set({ status: toStatus, updatedAt })
        .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId), eq(orders.status, fromStatus)))
        .returning({ id: orders.id })
        .get();

      return updated ? findDetail(restaurantId, orderId) : null;
    },

    async updatePaymentStatus(restaurantId, orderId, paymentStatus, updatedAt) {
      const updated = await db
        .update(orders)
        .set({ paymentStatus, updatedAt })
        .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
        .returning({ id: orders.id })
        .get();

      return updated ? findDetail(restaurantId, orderId) : null;
    },

    async assignCourierIf(restaurantId, orderId, courierMemberId, fromStatus, at) {
      const updated = await db
        .update(orders)
        .set({
          courierMemberId,
          status: "sent",
          updatedAt: at,
          // From `sent` (a reassignment) the original `sent_at` is kept.
          ...(fromStatus === "ready" ? { sentAt: at } : {}),
        })
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.id, orderId),
            eq(orders.status, fromStatus),
            eq(orders.fulfillment, "delivery"),
          ),
        )
        .returning({ id: orders.id })
        .get();

      return updated ? findDetail(restaurantId, orderId) : null;
    },

    async markDeliveredIf(restaurantId, orderId, fromStatus, options, at) {
      const conditions = [
        eq(orders.restaurantId, restaurantId),
        eq(orders.id, orderId),
        eq(orders.status, fromStatus),
      ];
      if (options.courierMemberId !== undefined) {
        conditions.push(eq(orders.courierMemberId, options.courierMemberId));
      }

      const updated = await db
        .update(orders)
        .set({
          status: "delivered",
          deliveredAt: at,
          updatedAt: at,
          ...(options.markPaid ? { paymentStatus: "paid" } : {}),
        })
        .where(and(...conditions))
        .returning({ id: orders.id })
        .get();

      return updated ? findDetail(restaurantId, orderId) : null;
    },

    async listForCourier(restaurantId, courierMemberId) {
      const rows = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.courierMemberId, courierMemberId),
            eq(orders.status, "sent"),
          ),
        )
        .orderBy(asc(orders.sentAt), asc(orders.number))
        .all();

      return rows.map(toCourierDelivery);
    },

    async courierSummary(restaurantId, fromMs, toMs, courierMemberId, status = "delivered") {
      const from = new Date(fromMs);
      const to = new Date(toMs);
      const deliveredInRange = and(eq(orders.status, "delivered"), gte(orders.deliveredAt, from), lt(orders.deliveredAt, to));
      const sentInRange = and(eq(orders.status, "sent"), gte(orders.sentAt, from), lt(orders.sentAt, to));
      const statusCondition =
        status === "delivered" ? deliveredInRange : status === "sent" ? sentInRange : or(deliveredInRange, sentInRange);
      const conditions = [eq(orders.restaurantId, restaurantId), statusCondition!];
      if (courierMemberId !== undefined) conditions.push(eq(orders.courierMemberId, courierMemberId));

      const rows = await db
        .select({
          memberId: orders.courierMemberId,
          firstName: restaurantMembers.firstName,
          lastName: restaurantMembers.lastName,
          active: restaurantMembers.active,
          delivered: sql<number>`coalesce(sum(CASE WHEN ${orders.status} = 'delivered' THEN 1 ELSE 0 END), 0)`,
          inProgress: sql<number>`coalesce(sum(CASE WHEN ${orders.status} = 'sent' THEN 1 ELSE 0 END), 0)`,
          shippingCents: sql<number>`coalesce(sum(${orders.shippingCents}), 0)`,
          tipCents: sql<number>`coalesce(sum(${orders.tipCents}), 0)`,
        })
        .from(orders)
        .leftJoin(restaurantMembers, eq(restaurantMembers.id, orders.courierMemberId))
        .where(and(...conditions))
        .groupBy(orders.courierMemberId, restaurantMembers.firstName, restaurantMembers.lastName, restaurantMembers.active)
        // "Sin repartidor" (null name) goes last; the rest by lowercased name.
        .orderBy(
          sql`${restaurantMembers.firstName} IS NULL`,
          asc(sql`lower(${restaurantMembers.firstName})`),
          asc(sql`lower(${restaurantMembers.lastName})`),
        )
        .all();

      return rows.map((row) => ({
        memberId: row.memberId,
        firstName: row.firstName,
        lastName: row.lastName,
        active: row.active,
        delivered: Number(row.delivered),
        inProgress: Number(row.inProgress),
        shippingCents: Number(row.shippingCents),
        tipCents: Number(row.tipCents),
      }));
    },

    async countByCourier(restaurantId, courierMemberId) {
      const res = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(and(eq(orders.restaurantId, restaurantId), eq(orders.courierMemberId, courierMemberId)))
        .get();
      return Number(res?.count ?? 0);
    },

    async listCouriers(restaurantId) {
      const rows = await db
        .select({
          memberId: restaurantMembers.id,
          firstName: restaurantMembers.firstName,
          lastName: restaurantMembers.lastName,
        })
        .from(restaurantMembers)
        .where(
          and(
            eq(restaurantMembers.restaurantId, restaurantId),
            eq(restaurantMembers.active, true),
            eq(restaurantMembers.isCourier, true),
          ),
        )
        .orderBy(
          asc(sql`lower(${restaurantMembers.firstName})`),
          asc(sql`lower(${restaurantMembers.lastName})`),
          asc(restaurantMembers.id),
        )
        .all();

      const inProgress = new Map<string, number>();
      const memberIds = rows.map((row) => row.memberId);
      for (let start = 0; start < memberIds.length; start += ITEMS_QUERY_CHUNK) {
        const chunk = memberIds.slice(start, start + ITEMS_QUERY_CHUNK);
        if (chunk.length === 0) continue;
        const counts = await db
          .select({ courierMemberId: orders.courierMemberId, count: sql<number>`count(*)` })
          .from(orders)
          .where(
            and(
              eq(orders.restaurantId, restaurantId),
              eq(orders.status, "sent"),
              inArray(orders.courierMemberId, chunk),
            ),
          )
          .groupBy(orders.courierMemberId)
          .all();
        for (const count of counts) {
          if (count.courierMemberId) inProgress.set(count.courierMemberId, Number(count.count));
        }
      }

      return rows.map((row) => ({
        memberId: row.memberId,
        firstName: row.firstName,
        lastName: row.lastName,
        inProgressOrders: inProgress.get(row.memberId) ?? 0,
      }));
    },
  };
}
