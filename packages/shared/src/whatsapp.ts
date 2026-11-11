import { z } from "zod";
import type { OrderMessageTargetStatus, OrderMessageTemplate } from "./order-messages";

/**
 * WhatsApp notices (change 17b). Menucito only sends free-form text messages while Meta's 24-hour
 * customer service window is open; no templates are used. `whatsappWindowOpen` is the single pure
 * rule the API and the admin share.
 */

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WHATSAPP_CONNECTION_STATUSES = ["connected", "disconnected", "error"] as const;
export type WhatsappConnectionStatus = (typeof WHATSAPP_CONNECTION_STATUSES)[number];

/** How the notice left: a free-form text by Meta, or the employee sending it by hand. */
export const WHATSAPP_NOTIFICATION_CHANNELS = ["text", "manual"] as const;
export type WhatsappNotificationChannel = (typeof WHATSAPP_NOTIFICATION_CHANNELS)[number];

export const WHATSAPP_NOTIFICATION_STATUSES = [
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
  "pending_manual",
] as const;
export type WhatsappNotificationStatus = (typeof WHATSAPP_NOTIFICATION_STATUSES)[number];

export const WHATSAPP_NOTIFICATION_STATUS_LABELS: Readonly<Record<WhatsappNotificationStatus, string>> = {
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
  skipped: "Omitido",
  pending_manual: "Pendiente de enviar",
};

/** A notice the board highlights: a failure, or one waiting for the employee to send it. */
export type WhatsappNotificationAlert = "failed" | "pending_manual";

export const WHATSAPP_MESSAGES = {
  unavailable: "WhatsApp no está disponible en este entorno",
  notConnected: "WhatsApp no está conectado",
  connectFailed: "No pudimos conectar WhatsApp. Probá de nuevo.",
  phoneInUse: "Ese número de WhatsApp ya está conectado en otro local",
  notificationNotFound: "Aviso no encontrado",
} as const;

/** Body of `POST /api/integrations/whatsapp/connect` (what Embedded Signup returns). */
export const whatsappConnectSchema = z.object({
  code: z.string(WHATSAPP_MESSAGES.connectFailed).trim().min(1, WHATSAPP_MESSAGES.connectFailed),
  wabaId: z.string(WHATSAPP_MESSAGES.connectFailed).trim().min(1, WHATSAPP_MESSAGES.connectFailed),
  /**
   * Coexistence onboarding (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) may report only the WABA; the
   * API then reads the number from it.
   */
  phoneNumberId: z.string().trim().min(1).optional(),
});

export type WhatsappConnectInput = z.infer<typeof whatsappConnectSchema>;

/** Body of `PATCH /api/integrations/whatsapp`. */
export const whatsappAutoSendSchema = z.object({ autoSend: z.boolean() });

export type WhatsappAutoSendInput = z.infer<typeof whatsappAutoSendSchema>;

/** Connection of the local, as the admin shows it. */
export interface WhatsappConnection {
  status: WhatsappConnectionStatus;
  /** Normalized digits (`549…`). */
  displayPhone: string;
  displayName: string;
  businessVerified: boolean;
  /** The local can keep using WhatsApp Business on the phone. */
  coexistence: boolean;
  autoSend: boolean;
  /** Text from Meta when `status` is `error`. */
  statusDetail: string | null;
  connectedAt: number | null;
}

/** Avisos of the last 30 days: sent (by Meta or by hand), free (text) and failed. */
export interface WhatsappStats {
  sent: number;
  free: number;
  failed: number;
}

/** `GET /api/integrations/whatsapp`. */
export interface WhatsappIntegration {
  connection: WhatsappConnection | null;
  stats: WhatsappStats;
}

/** One notice of an order and a transition, as the detail history shows it. */
export interface WhatsappNotification {
  id: string;
  orderId: string;
  targetStatus: OrderMessageTargetStatus;
  channel: WhatsappNotificationChannel;
  status: WhatsappNotificationStatus;
  /** Text already built: what "Enviar a mano" opens and what was sent. */
  body: string;
  errorCode: string | null;
  errorMessage: string | null;
  waMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WhatsappNotificationList {
  notifications: WhatsappNotification[];
}

/** What the orders screen needs to decide whether a status change opens WhatsApp Web. */
export interface WhatsappNoticeConfig {
  available: boolean;
  connected: boolean;
  autoSend: boolean;
  templates: OrderMessageTemplate[];
}

/**
 * Whether Meta's customer service window is open: the customer wrote to the store less than 24 hours
 * ago. `false` when there is no inbound message yet.
 */
export function whatsappWindowOpen(lastInboundAt: number | null | undefined, now: number): boolean {
  return lastInboundAt != null && now - lastInboundAt < WHATSAPP_WINDOW_MS;
}

/** `https://wa.me/<phone>?text=<body>`: the hand-off the employee sends himself. */
export function whatsappManualUrl(phone: string, body: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
}
