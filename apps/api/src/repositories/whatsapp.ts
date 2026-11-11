import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { OrderMessageTargetStatus, WhatsappNotification } from "@menucito/shared";
import {
  customers,
  orderNotifications,
  orders,
  restaurants,
  whatsappConnections,
  type OrderNotificationRow,
  type WhatsappConnectionRow,
} from "../db/schema";

/**
 * WhatsApp connections and notices (change 17b). One connection per local and one notice per order
 * and destination status; the unique key is what makes Meta's retries and concurrent status changes
 * idempotent.
 */

export interface ConnectionFields {
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
  accessTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  status: "connected" | "disconnected" | "error";
  statusDetail: string | null;
  businessVerified: boolean;
  coexistence: boolean;
  autoSend: boolean;
  connectedAt: Date;
}

export interface NotificationFields {
  targetStatus: OrderMessageTargetStatus;
  channel: "text" | "manual";
  status: WhatsappNotification["status"];
  body: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  waMessageId?: string | null;
}

/** What the notifier needs from the order and the customer, in one query. */
export interface NoticeContext {
  customerName: string;
  customerPhone: string;
  customerId: string | null;
  whatsappOptInAt: number | null;
  whatsappOptOut: boolean;
  waLastInboundAt: number | null;
  restaurantName: string;
}

export interface InboundCustomer {
  id: string;
  phone: string;
  waBsuid: string | null;
  waLastInboundAt: number | null;
}

export interface WhatsappRepository {
  findConnection(restaurantId: string): Promise<WhatsappConnectionRow | null>;
  findConnectionByPhoneNumberId(phoneNumberId: string): Promise<WhatsappConnectionRow | null>;
  findConnectionByWabaId(wabaId: string): Promise<WhatsappConnectionRow | null>;
  upsertConnection(restaurantId: string, fields: ConnectionFields, updatedAt: Date): Promise<void>;
  updateConnection(
    restaurantId: string,
    fields: Partial<ConnectionFields> & { updatedAt: Date },
  ): Promise<void>;
  noticeContext(restaurantId: string, orderId: string): Promise<NoticeContext | null>;
  findNotification(
    restaurantId: string,
    orderId: string,
    targetStatus: OrderMessageTargetStatus,
  ): Promise<WhatsappNotification | null>;
  findNotificationById(restaurantId: string, orderId: string, id: string): Promise<WhatsappNotification | null>;
  findNotificationByWaMessageId(restaurantId: string, waMessageId: string): Promise<WhatsappNotification | null>;
  listNotifications(restaurantId: string, orderId: string): Promise<WhatsappNotification[]>;
  /**
   * Inserts the notice unless that order and transition already has one. Returns whether this call
   * won, so the caller only talks to Meta once.
   */
  insertNotification(
    id: string,
    restaurantId: string,
    orderId: string,
    fields: NotificationFields,
    at: Date,
  ): Promise<boolean>;
  updateNotification(
    restaurantId: string,
    id: string,
    fields: Partial<NotificationFields> & { updatedAt: Date },
  ): Promise<void>;
  /** Status webhooks know the Meta message id, not the local id of the notice. */
  updateNotificationByWaMessageId(
    restaurantId: string,
    waMessageId: string,
    fields: Partial<NotificationFields> & { updatedAt: Date },
  ): Promise<void>;
  statsSince(restaurantId: string, since: Date): Promise<{ sent: number; free: number; failed: number }>;
  findInboundCustomer(restaurantId: string, phone: string, bsuid: string | null): Promise<InboundCustomer | null>;
  recordInbound(customer: InboundCustomer, at: Date, bsuid: string | null): Promise<void>;
}

function toNotification(row: OrderNotificationRow): WhatsappNotification {
  return {
    id: row.id,
    orderId: row.orderId,
    targetStatus: row.targetStatus as OrderMessageTargetStatus,
    channel: row.channel as WhatsappNotification["channel"],
    status: row.status as WhatsappNotification["status"],
    body: row.body,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    waMessageId: row.waMessageId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function createWhatsappRepository(d1: D1Database): WhatsappRepository {
  const db = drizzle(d1);

  return {
    async findConnection(restaurantId) {
      return (await db.select().from(whatsappConnections).where(eq(whatsappConnections.restaurantId, restaurantId)).get()) ?? null;
    },

    async findConnectionByPhoneNumberId(phoneNumberId) {
      return (
        (await db
          .select()
          .from(whatsappConnections)
          .where(eq(whatsappConnections.phoneNumberId, phoneNumberId))
          .get()) ?? null
      );
    },

    async findConnectionByWabaId(wabaId) {
      return (await db.select().from(whatsappConnections).where(eq(whatsappConnections.wabaId, wabaId)).get()) ?? null;
    },

    async upsertConnection(restaurantId, fields, updatedAt) {
      await db
        .insert(whatsappConnections)
        .values({ restaurantId, ...fields, updatedAt })
        .onConflictDoUpdate({
          target: whatsappConnections.restaurantId,
          set: { ...fields, updatedAt },
        });
    },

    async updateConnection(restaurantId, fields) {
      await db.update(whatsappConnections).set(fields).where(eq(whatsappConnections.restaurantId, restaurantId));
    },

    async noticeContext(restaurantId, orderId) {
      const row = await db
        .select({
          customerName: orders.customerName,
          customerPhone: orders.customerPhone,
          customerId: customers.id,
          whatsappOptInAt: customers.whatsappOptInAt,
          whatsappOptOut: customers.whatsappOptOut,
          waLastInboundAt: customers.waLastInboundAt,
          restaurantName: restaurants.name,
        })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
        .get();
      if (!row) return null;
      return {
        ...row,
        whatsappOptOut: row.whatsappOptOut ?? false,
        whatsappOptInAt: row.whatsappOptInAt?.getTime() ?? null,
        waLastInboundAt: row.waLastInboundAt?.getTime() ?? null,
      };
    },

    async findNotification(restaurantId, orderId, targetStatus) {
      const row = await db
        .select()
        .from(orderNotifications)
        .where(
          and(
            eq(orderNotifications.restaurantId, restaurantId),
            eq(orderNotifications.orderId, orderId),
            eq(orderNotifications.targetStatus, targetStatus),
          ),
        )
        .get();
      return row ? toNotification(row) : null;
    },

    async findNotificationById(restaurantId, orderId, id) {
      const row = await db
        .select()
        .from(orderNotifications)
        .where(
          and(
            eq(orderNotifications.restaurantId, restaurantId),
            eq(orderNotifications.orderId, orderId),
            eq(orderNotifications.id, id),
          ),
        )
        .get();
      return row ? toNotification(row) : null;
    },

    async findNotificationByWaMessageId(restaurantId, waMessageId) {
      const row = await db
        .select()
        .from(orderNotifications)
        .where(and(eq(orderNotifications.restaurantId, restaurantId), eq(orderNotifications.waMessageId, waMessageId)))
        .get();
      return row ? toNotification(row) : null;
    },

    async listNotifications(restaurantId, orderId) {
      const rows = await db
        .select()
        .from(orderNotifications)
        .where(and(eq(orderNotifications.restaurantId, restaurantId), eq(orderNotifications.orderId, orderId)))
        .orderBy(desc(orderNotifications.createdAt), asc(orderNotifications.targetStatus))
        .all();
      return rows.map(toNotification);
    },

    async insertNotification(id, restaurantId, orderId, fields, at) {
      const inserted = await db
        .insert(orderNotifications)
        .values({
          id,
          restaurantId,
          orderId,
          targetStatus: fields.targetStatus,
          channel: fields.channel,
          status: fields.status,
          body: fields.body,
          errorCode: fields.errorCode ?? null,
          errorMessage: fields.errorMessage ?? null,
          waMessageId: fields.waMessageId ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing()
        .returning({ id: orderNotifications.id });
      return inserted.length > 0;
    },

    async updateNotification(restaurantId, id, fields) {
      await db
        .update(orderNotifications)
        .set(fields)
        .where(and(eq(orderNotifications.restaurantId, restaurantId), eq(orderNotifications.id, id)));
    },

    async updateNotificationByWaMessageId(restaurantId, waMessageId, fields) {
      await db
        .update(orderNotifications)
        .set(fields)
        .where(and(eq(orderNotifications.restaurantId, restaurantId), eq(orderNotifications.waMessageId, waMessageId)));
    },

    async statsSince(restaurantId, since) {
      const row = await d1
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END), 0) AS sent,
             COALESCE(SUM(CASE WHEN channel = 'text' AND status IN ('sent','delivered','read') THEN 1 ELSE 0 END), 0) AS free,
             COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
           FROM order_notifications
          WHERE restaurant_id = ? AND created_at >= ?`,
        )
        .bind(restaurantId, since.getTime())
        .first<{ sent: number; free: number; failed: number }>();
      return {
        sent: Number(row?.sent ?? 0),
        free: Number(row?.free ?? 0),
        failed: Number(row?.failed ?? 0),
      };
    },

    async findInboundCustomer(restaurantId, phone, bsuid) {
      type Row = { id: string; phone: string; waBsuid: string | null; waLastInboundAt: number | null };
      const select = `SELECT id, phone, wa_bsuid AS waBsuid, wa_last_inbound_at AS waLastInboundAt
                        FROM customers`;
      let row: Row | null = null;
      if (phone) {
        row = await d1
          .prepare(`${select} WHERE restaurant_id = ? AND phone = ? LIMIT 1`)
          .bind(restaurantId, phone)
          .first<Row>();
      }
      if (!row && bsuid) {
        row = await d1
          .prepare(`${select} WHERE restaurant_id = ? AND wa_bsuid = ? LIMIT 1`)
          .bind(restaurantId, bsuid)
          .first<Row>();
      }
      return row
        ? { ...row, waLastInboundAt: row.waLastInboundAt === null ? null : Number(row.waLastInboundAt) }
        : null;
    },

    async recordInbound(customer, at, bsuid) {
      const newer = customer.waLastInboundAt === null || at.getTime() > customer.waLastInboundAt;
      const newBsuid = bsuid && bsuid !== customer.waBsuid ? bsuid : null;
      // Meta retries old events: a stale one changes nothing instead of moving `updated_at` back.
      if (!newer && !newBsuid) return;
      await db
        .update(customers)
        .set({
          ...(newer ? { waLastInboundAt: at } : {}),
          ...(newBsuid ? { waBsuid: newBsuid } : {}),
          updatedAt: at,
        })
        .where(eq(customers.id, customer.id));
    },
  };
}
