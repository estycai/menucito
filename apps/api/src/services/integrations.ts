import {
  WHATSAPP_WINDOW_MS,
  type WhatsappAutoSendInput,
  type WhatsappConnection,
  type WhatsappConnectInput,
  type WhatsappIntegration,
  type WhatsappNoticeConfig,
} from "@menucito/shared";
import type { Env } from "../env";
import type { OrderMessagesRepository } from "../repositories/order-messages";
import { createOrderMessagesRepository } from "../repositories/order-messages";
import type { WhatsappRepository } from "../repositories/whatsapp";
import { createWhatsappRepository } from "../repositories/whatsapp";
import { UniqueViolationError, translatingUniqueViolations } from "../repositories/errors";
import type { WhatsappConnectionRow } from "../db/schema";
import { WhatsappError, WhatsappPhoneInUseError, WhatsappUnavailableError } from "./errors";
import { encryptToken, decryptToken } from "../whatsapp/crypto";
import { createWhatsappClient, type WhatsappClient } from "../whatsapp/graph";

/** A Meta app with WhatsApp, the secret and the token key are all needed to offer the feature. */
export function isWhatsappConfigured(env: Pick<Env, "META_APP_ID" | "META_APP_SECRET" | "WHATSAPP_TOKEN_KEY">): boolean {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.WHATSAPP_TOKEN_KEY);
}

function toConnection(row: WhatsappConnectionRow | null): WhatsappConnection | null {
  if (!row) return null;
  return {
    status: row.status as WhatsappConnection["status"],
    displayPhone: row.displayPhone,
    displayName: row.displayName,
    businessVerified: row.businessVerified,
    coexistence: row.coexistence,
    autoSend: row.autoSend,
    statusDetail: row.statusDetail,
    connectedAt: row.connectedAt.getTime(),
  };
}

export interface IntegrationsDependencies {
  repo: WhatsappRepository;
  orderMessages: OrderMessagesRepository;
  client: WhatsappClient;
  tokenKey: string;
  configured: boolean;
  now?: () => Date;
}

export function createWhatsappIntegrationsService({
  repo,
  orderMessages,
  client,
  tokenKey,
  configured,
  now = () => new Date(),
}: IntegrationsDependencies) {
  function requireConfigured() {
    if (!configured) throw new WhatsappUnavailableError();
  }

  async function get(restaurantId: string): Promise<WhatsappIntegration> {
    requireConfigured();
    const [connection, stats] = await Promise.all([
      repo.findConnection(restaurantId),
      repo.statsSince(restaurantId, new Date(now().getTime() - 30 * WHATSAPP_WINDOW_MS)),
    ]);
    return { connection: toConnection(connection), stats };
  }

  /** The orders screen needs the switch, the connection and the messages to decide the hand-off. */
  async function noticeConfig(restaurantId: string): Promise<WhatsappNoticeConfig> {
    const [connection, templates] = await Promise.all([
      repo.findConnection(restaurantId),
      orderMessages.list(restaurantId),
    ]);
    return {
      available: configured,
      connected: connection?.status === "connected",
      autoSend: connection?.autoSend ?? false,
      templates,
    };
  }

  return {
    get,
    noticeConfig,

    async connect(restaurantId: string, input: WhatsappConnectInput): Promise<WhatsappConnection> {
      requireConfigured();
      const current = await repo.findConnection(restaurantId);
      try {
        const token = await client.exchangeCode(input.code);
        await client.subscribeApp(input.wabaId, token.accessToken);
        const phoneNumberId =
          input.phoneNumberId ?? (await client.firstPhoneNumberId(input.wabaId, token.accessToken));
        if (!phoneNumberId) throw new Error("The WABA has no phone number");
        const [profile, businessVerified] = await Promise.all([
          client.phoneProfile(phoneNumberId, token.accessToken),
          client.businessVerified(input.wabaId, token.accessToken),
        ]);
        const at = now();
        const accessTokenEnc = await encryptToken(tokenKey, token.accessToken);
        await translatingUniqueViolations(() =>
          repo.upsertConnection(
            restaurantId,
            {
              wabaId: input.wabaId,
              phoneNumberId,
              displayPhone: profile.displayPhone,
              displayName: profile.displayName,
              accessTokenEnc,
              tokenExpiresAt: token.expiresAt,
              status: "connected",
              statusDetail: null,
              businessVerified,
              coexistence: true,
              // The switch starts on; a local that already turned it off keeps its choice.
              autoSend: current?.autoSend ?? true,
              connectedAt: at,
            },
            at,
          ),
        );
        return toConnection(await repo.findConnection(restaurantId))!;
      } catch (error) {
        if (error instanceof UniqueViolationError && error.columns.includes("phone_number_id")) {
          throw new WhatsappPhoneInUseError();
        }
        console.error("[whatsapp] connect failed", error instanceof Error ? error.message : String(error));
        throw new WhatsappError();
      }
    },

    async setAutoSend(restaurantId: string, input: WhatsappAutoSendInput): Promise<WhatsappIntegration> {
      requireConfigured();
      if (!(await repo.findConnection(restaurantId))) throw new WhatsappError("WhatsApp no está conectado");
      await repo.updateConnection(restaurantId, { autoSend: input.autoSend, updatedAt: now() });
      return get(restaurantId);
    },

    async disconnect(restaurantId: string): Promise<WhatsappIntegration> {
      requireConfigured();
      const connection = await repo.findConnection(restaurantId);
      if (connection?.accessTokenEnc) {
        try {
          await client.unsubscribeApp(connection.wabaId, await decryptToken(tokenKey, connection.accessTokenEnc));
        } catch (error) {
          // The local asked to disconnect: a Meta failure must not keep the token stored.
          console.warn("[whatsapp] unsubscribe failed", error instanceof Error ? error.message : String(error));
        }
      }
      await repo.updateConnection(restaurantId, {
        status: "disconnected",
        statusDetail: null,
        accessTokenEnc: null,
        tokenExpiresAt: null,
        updatedAt: now(),
      });
      return get(restaurantId);
    },
  };
}

export type WhatsappIntegrationsService = ReturnType<typeof createWhatsappIntegrationsService>;

export function whatsappIntegrationsFor(
  env: Pick<
    Env,
    "DB" | "META_APP_ID" | "META_APP_SECRET" | "WHATSAPP_TOKEN_KEY" | "WHATSAPP_CLIENT"
  >,
): WhatsappIntegrationsService {
  return createWhatsappIntegrationsService({
    repo: createWhatsappRepository(env.DB),
    orderMessages: createOrderMessagesRepository(env.DB),
    client: env.WHATSAPP_CLIENT ?? createWhatsappClient(env),
    tokenKey: env.WHATSAPP_TOKEN_KEY ?? "",
    configured: isWhatsappConfigured(env),
  });
}
