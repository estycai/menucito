import type { WhatsappNotificationStatus } from "@menucito/shared";
import type { WhatsappRepository } from "../repositories/whatsapp";
import { whatsappErrorMessageForCode } from "../whatsapp/errors";

/**
 * Meta webhooks (change 17b). Entrant messages only record when the customer wrote (the 24-hour
 * window); message statuses advance the notice, never backwards. Meta retries for up to 7 days, so
 * every branch is idempotent.
 */

interface WebhookError {
  code?: number;
  title?: string;
  error_data?: { details?: string };
}

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  contacts?: { user_id?: string; wa_id?: string }[];
  messages?: { from?: string; id?: string; timestamp?: string }[];
  statuses?: { id?: string; status?: string; timestamp?: string; errors?: WebhookError[] }[];
  event?: string;
  alert?: string;
}

interface WebhookPayload {
  entry?: { id?: string; changes?: { field?: string; value?: WebhookValue }[] }[];
}

const STATUS_RANK: Readonly<Record<WhatsappNotificationStatus, number>> = {
  sending: 0,
  pending_manual: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  skipped: 4,
};

function webhookDate(timestamp: string | undefined, fallback: Date): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : fallback;
}

export function createWhatsappWebhookService(repo: WhatsappRepository, now: () => Date = () => new Date()) {
  return {
    async process(payload: unknown): Promise<void> {
      if (!payload || typeof payload !== "object") return;
      const entries = (payload as WebhookPayload).entry ?? [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (!value) continue;
          const phoneNumberId = value.metadata?.phone_number_id;
          const connection =
            (phoneNumberId ? await repo.findConnectionByPhoneNumberId(phoneNumberId) : null) ??
            (entry.id ? await repo.findConnectionByWabaId(entry.id) : null);
          if (!connection) continue;

          if (change.field === "messages") {
            // The content of the message is never stored: only when the customer last wrote.
            const bsuid = value.contacts?.[0]?.user_id ?? null;
            for (const message of value.messages ?? []) {
              if (!message.from) continue;
              const phone = message.from.replace(/\D/g, "");
              const customer = await repo.findInboundCustomer(connection.restaurantId, phone, bsuid);
              if (customer) await repo.recordInbound(customer, webhookDate(message.timestamp, now()), bsuid);
            }

            for (const status of value.statuses ?? []) {
              if (!status.id || !status.status) continue;
              const next = status.status as WhatsappNotificationStatus;
              if (!(next in STATUS_RANK)) continue;
              const notification = await repo.findNotificationByWaMessageId(connection.restaurantId, status.id);
              if (!notification) continue;
              // Meta can deliver an older status after a newer one: it never goes backwards.
              if (STATUS_RANK[next] <= STATUS_RANK[notification.status]) continue;
              const metaCode = status.errors?.[0]?.code ?? null;
              await repo.updateNotificationByWaMessageId(connection.restaurantId, status.id, {
                status: next,
                errorCode: next === "failed" ? String(metaCode ?? "UNKNOWN") : null,
                errorMessage: next === "failed" ? whatsappErrorMessageForCode(metaCode) : null,
                updatedAt: webhookDate(status.timestamp, now()),
              });
            }
          } else if (change.field === "account_update" || change.field === "account_alerts") {
            const detail =
              [value.event, value.alert].find((text): text is string => typeof text === "string") ??
              "Meta informó un problema con la cuenta";
            await repo.updateConnection(connection.restaurantId, {
              status: "error",
              statusDetail: detail,
              updatedAt: now(),
            });
          }
        }
      }
    },
  };
}

export type WhatsappWebhookService = ReturnType<typeof createWhatsappWebhookService>;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** `X-Hub-Signature-256` is `sha256=<hex>` of the raw body, keyed with the Meta app secret. */
export async function validWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return sameString(expected, signature.slice("sha256=".length));
}
