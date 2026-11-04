import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  ACTIVE_ORDER_STATUSES,
  type Fulfillment,
  type OrderDateField,
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
  customers,
  orderItems,
  orders,
  type OrderDbRow,
  type OrderItemDbRow,
} from "../db/schema";
import { translatingUniqueViolations } from "./errors";

/** D1 caps bound parameters per statement at 100; keep `IN (...)` lists below it. */
const ITEMS_QUERY_CHUNK = 90;

export interface InsertOrderData {
  orderId: string;
  restaurantId: string;
  clientToken: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  subtotalCents: number;
  shippingCents: number;
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
   * Inserts the customer (deduplicated by phone), the order and its items in one batch. Throws
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

  function toOrderDetail(orderRow: OrderDbRow, itemRows: OrderItemDbRow[]): OrderDetail {
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
      notes: orderRow.notes,
      subtotalCents: orderRow.subtotalCents,
      shippingCents: orderRow.shippingCents,
      discountCents: orderRow.discountCents,
      totalCents: orderRow.totalCents,
      items: itemRows.map(toOrderItem),
      createdAt: orderRow.createdAt.getTime(),
      updatedAt: orderRow.updatedAt.getTime(),
    };
  }

  async function getOrderDetail(orderRow: OrderDbRow): Promise<OrderDetail> {
    const itemRows = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderRow.id))
      .orderBy(orderItems.position)
      .all();
    return toOrderDetail(orderRow, itemRows);
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

    const dateColumn = filter.dateField === "updated" ? orders.updatedAt : orders.createdAt;

    if (filter.fromMs !== undefined) {
      conditions.push(gte(dateColumn, new Date(filter.fromMs)));
    }

    if (filter.toMs !== undefined) {
      conditions.push(lt(dateColumn, new Date(filter.toMs)));
    }

    return and(...conditions);
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
          subtotalCents: data.subtotalCents,
          shippingCents: data.shippingCents,
          discountCents: 0,
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
        })
        .from(orders)
        .where(whereCondition)
        .orderBy(desc(orders.number))
        .limit(limit + 1)
        .all();

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;

      const orderSummaries: OrderSummary[] = sliced.map(({ order, itemCount }) => ({
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
      return rows.map((row) => toOrderDetail(row, items.get(row.id) ?? []));
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
  };
}
