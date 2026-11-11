import {
  fillOrderMessage,
  resolveOrderMessage,
  whatsappWindowOpen,
  type OrderDetail,
  type OrderMessageTargetStatus,
  type OrderStatus,
  type WhatsappNotification,
} from "@menucito/shared";
import type { Env } from "../env";
import type { OrderMessagesRepository } from "../repositories/order-messages";
import { createOrderMessagesRepository } from "../repositories/order-messages";
import type { OrdersRepository } from "../repositories/orders";
import { createOrdersRepository } from "../repositories/orders";
import type { WhatsappRepository } from "../repositories/whatsapp";
import { createWhatsappRepository } from "../repositories/whatsapp";
import { OrderNotFoundError, NotificationNotFoundError } from "./errors";
import { decryptToken } from "../whatsapp/crypto";
import { isExpiredToken, whatsappErrorCode, whatsappErrorMessage } from "../whatsapp/errors";
import { createWhatsappClient, type WhatsappClient } from "../whatsapp/graph";

/**
 * Turns an order status change into at most one WhatsApp notice. Order of decisions (change 17b):
 * connection + auto-send, message written for the transition, customer permission, already notified,
 * open window (free text) or closed window (`pending_manual`). It never sends a Meta template.
 */

const TARGET_STATUSES: ReadonlySet<string> = new Set(["preparing", "ready", "sent", "delivered", "cancelled"]);

function isTargetStatus(status: OrderStatus): status is OrderMessageTargetStatus {
  return TARGET_STATUSES.has(status);
}

export interface WhatsappNotifierDependencies {
  repo: WhatsappRepository;
  orders: OrdersRepository;
  orderMessages: OrderMessagesRepository;
  client: WhatsappClient;
  tokenKey: string;
  now?: () => Date;
  generateId?: () => string;
}

export function createWhatsappNotifier({
  repo,
  orders,
  orderMessages,
  client,
  tokenKey,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
}: WhatsappNotifierDependencies) {
  function messageFor(
    templates: Awaited<ReturnType<OrderMessagesRepository["list"]>>,
    order: OrderDetail,
    targetStatus: OrderMessageTargetStatus,
    restaurantName: string,
  ): string | null {
    const template = resolveOrderMessage(templates, order.fulfillment, targetStatus);
    if (!template) return null;
    return fillOrderMessage(template, {
      customerName: order.customerName,
      number: order.number,
      totalCents: order.totalCents,
      restaurantName,
    });
  }

  async function sendText(
    restaurantId: string,
    notificationId: string,
    phoneNumberId: string,
    accessTokenEnc: string | null,
    to: string,
    body: string,
  ): Promise<void> {
    const at = now();
    try {
      if (!accessTokenEnc) throw new Error("missing token");
      const token = await decryptToken(tokenKey, accessTokenEnc);
      const sent = await client.sendText(phoneNumberId, token, to, body);
      await repo.updateNotification(restaurantId, notificationId, {
        status: "sent",
        waMessageId: sent.messageId,
        errorCode: null,
        errorMessage: null,
        updatedAt: at,
      });
    } catch (error) {
      if (isExpiredToken(error)) {
        await repo.updateConnection(restaurantId, {
          status: "error",
          statusDetail: whatsappErrorMessage(error),
          updatedAt: at,
        });
      }
      await repo.updateNotification(restaurantId, notificationId, {
        status: "failed",
        errorCode: whatsappErrorCode(error),
        errorMessage: whatsappErrorMessage(error),
        updatedAt: at,
      });
    }
  }

  return {
    /** Runs after a successful status change; it never throws to the caller. */
    async onStatusChanged(restaurantId: string, order: OrderDetail, targetStatus: OrderStatus): Promise<void> {
      if (!isTargetStatus(targetStatus)) return;

      try {
        const connection = await repo.findConnection(restaurantId);
        if (!connection || connection.status !== "connected" || !connection.autoSend) return;

        const context = await repo.noticeContext(restaurantId, order.id);
        if (!context) return;

        const templates = await orderMessages.list(restaurantId);
        const body = messageFor(templates, order, targetStatus, context.restaurantName);
        if (!body) return;

        if (await repo.findNotification(restaurantId, order.id, targetStatus)) return;

        const at = now();
        const id = generateId();
        const allowed = context.customerId !== null && context.whatsappOptInAt !== null && !context.whatsappOptOut;
        if (!allowed) {
          await repo.insertNotification(
            id,
            restaurantId,
            order.id,
            { targetStatus, channel: "text", status: "skipped", body },
            at,
          );
          return;
        }

        if (!whatsappWindowOpen(context.waLastInboundAt, at.getTime())) {
          await repo.insertNotification(
            id,
            restaurantId,
            order.id,
            { targetStatus, channel: "manual", status: "pending_manual", body },
            at,
          );
          return;
        }

        const inserted = await repo.insertNotification(
          id,
          restaurantId,
          order.id,
          { targetStatus, channel: "text", status: "sending", body },
          at,
        );
        if (inserted) await sendText(restaurantId, id, connection.phoneNumberId, connection.accessTokenEnc, order.customerPhone, body);
      } catch (error) {
        // A notice never breaks the status change: log it and leave the order as it is.
        console.error("[whatsapp-notifier] status change", error instanceof Error ? error.message : String(error));
      }
    },

    async list(restaurantId: string, orderId: string): Promise<WhatsappNotification[]> {
      if (!(await orders.findDetail(restaurantId, orderId))) throw new OrderNotFoundError();
      return repo.listNotifications(restaurantId, orderId);
    },

    /** "Reintentar": re-decides the channel and sends again. It ignores the auto-send switch. */
    async retry(restaurantId: string, orderId: string, notificationId: string): Promise<WhatsappNotification> {
      const order = await orders.findDetail(restaurantId, orderId);
      if (!order) throw new OrderNotFoundError();
      const notification = await repo.findNotificationById(restaurantId, orderId, notificationId);
      if (!notification) throw new NotificationNotFoundError();

      const at = now();
      const context = await repo.noticeContext(restaurantId, orderId);
      const templates = context ? await orderMessages.list(restaurantId) : [];
      const body = context ? messageFor(templates, order, notification.targetStatus, context.restaurantName) : null;
      const allowed =
        context !== null && context.customerId !== null && context.whatsappOptInAt !== null && !context.whatsappOptOut;

      if (!body || !allowed) {
        await repo.updateNotification(restaurantId, notificationId, {
          status: "skipped",
          errorCode: null,
          errorMessage: null,
          updatedAt: at,
        });
        return (await repo.findNotificationById(restaurantId, orderId, notificationId))!;
      }

      const connection = await repo.findConnection(restaurantId);
      if (!connection || connection.status !== "connected" || !connection.accessTokenEnc) {
        await repo.updateNotification(restaurantId, notificationId, {
          status: "failed",
          body,
          errorCode: "NOT_CONNECTED",
          errorMessage: "WhatsApp no está conectado",
          updatedAt: at,
        });
        return (await repo.findNotificationById(restaurantId, orderId, notificationId))!;
      }

      if (!whatsappWindowOpen(context.waLastInboundAt, at.getTime())) {
        await repo.updateNotification(restaurantId, notificationId, {
          channel: "manual",
          status: "pending_manual",
          body,
          errorCode: null,
          errorMessage: null,
          waMessageId: null,
          updatedAt: at,
        });
        return (await repo.findNotificationById(restaurantId, orderId, notificationId))!;
      }

      await repo.updateNotification(restaurantId, notificationId, {
        channel: "text",
        status: "sending",
        body,
        errorCode: null,
        errorMessage: null,
        waMessageId: null,
        updatedAt: at,
      });
      await sendText(restaurantId, notificationId, connection.phoneNumberId, connection.accessTokenEnc, order.customerPhone, body);
      return (await repo.findNotificationById(restaurantId, orderId, notificationId))!;
    },

    /** "Enviar a mano" was confirmed: the notice counts as sent without Meta's message id. */
    async markManual(restaurantId: string, orderId: string, notificationId: string): Promise<WhatsappNotification> {
      if (!(await orders.findDetail(restaurantId, orderId))) throw new OrderNotFoundError();
      if (!(await repo.findNotificationById(restaurantId, orderId, notificationId))) throw new NotificationNotFoundError();
      await repo.updateNotification(restaurantId, notificationId, {
        channel: "manual",
        status: "sent",
        errorCode: null,
        errorMessage: null,
        waMessageId: null,
        updatedAt: now(),
      });
      return (await repo.findNotificationById(restaurantId, orderId, notificationId))!;
    },
  };
}

export type WhatsappNotifier = ReturnType<typeof createWhatsappNotifier>;

export function whatsappNotifierFor(
  env: Pick<Env, "DB" | "META_APP_ID" | "META_APP_SECRET" | "WHATSAPP_TOKEN_KEY" | "WHATSAPP_CLIENT">,
): WhatsappNotifier {
  return createWhatsappNotifier({
    repo: createWhatsappRepository(env.DB),
    orders: createOrdersRepository(env.DB),
    orderMessages: createOrderMessagesRepository(env.DB),
    client: env.WHATSAPP_CLIENT ?? createWhatsappClient(env),
    tokenKey: env.WHATSAPP_TOKEN_KEY ?? "",
  });
}
