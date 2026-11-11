import type { Env } from "../env";

/**
 * Thin client of the WhatsApp Business Platform (Meta Graph API). The version is pinned: never use
 * "latest". Tests replace it with a fake through the `WHATSAPP_CLIENT` binding.
 */

export const GRAPH_API_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface WhatsappAccessToken {
  accessToken: string;
  expiresAt: Date | null;
}

export interface WhatsappPhoneProfile {
  /** Normalized digits, as Meta returns them (`549…`). */
  displayPhone: string;
  displayName: string;
}

export interface WhatsappClient {
  exchangeCode(code: string): Promise<WhatsappAccessToken>;
  subscribeApp(wabaId: string, accessToken: string): Promise<void>;
  unsubscribeApp(wabaId: string, accessToken: string): Promise<void>;
  /** First phone number of the WABA (a coexistence WABA holds exactly one); `null` when it has none. */
  firstPhoneNumberId(wabaId: string, accessToken: string): Promise<string | null>;
  phoneProfile(phoneNumberId: string, accessToken: string): Promise<WhatsappPhoneProfile>;
  /** Whether the local's Meta business is verified; `false` when Meta does not answer the field. */
  businessVerified(wabaId: string, accessToken: string): Promise<boolean>;
  sendText(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<{ messageId: string }>;
}

/** A Meta answer that is not 2xx. `metaCode` is Graph's error code, when it names one. */
export class WhatsappApiError extends Error {
  constructor(
    readonly metaCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WhatsappApiError";
  }
}

interface GraphErrorBody {
  error?: { code?: number; message?: string };
}

async function request(url: string, init: RequestInit, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new WhatsappApiError(null, `${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await res.json().catch(() => null)) as GraphErrorBody | null;
  if (!res.ok) {
    const code = typeof body?.error?.code === "number" ? body.error.code : null;
    // The message is Meta's; it carries no customer data.
    console.error(`[whatsapp] ${what} responded ${res.status}: ${body?.error?.message ?? ""}`);
    throw new WhatsappApiError(code, body?.error?.message ?? `${what} answered ${res.status}`);
  }
  return body;
}

export function createWhatsappClient(env: Pick<Env, "META_APP_ID" | "META_APP_SECRET">): WhatsappClient {
  function requireApp() {
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new WhatsappApiError(null, "META_APP_ID or META_APP_SECRET is not set");
    }
    return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET };
  }

  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

  return {
    async exchangeCode(code) {
      const { appId, appSecret } = requireApp();
      const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
      const body = (await request(`${GRAPH_BASE}/oauth/access_token?${params}`, {}, "Code exchange")) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!body.access_token) throw new WhatsappApiError(null, "Code exchange without an access token");
      return {
        accessToken: body.access_token,
        expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
      };
    },

    async subscribeApp(wabaId, accessToken) {
      await request(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: "POST",
        headers: auth(accessToken),
      }, "App subscription");
    },

    async unsubscribeApp(wabaId, accessToken) {
      await request(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: "DELETE",
        headers: auth(accessToken),
      }, "App unsubscription");
    },

    async firstPhoneNumberId(wabaId, accessToken) {
      const params = new URLSearchParams({ fields: "id" });
      const body = (await request(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/phone_numbers?${params}`, {
        headers: auth(accessToken),
      }, "Phone numbers")) as { data?: { id?: string }[] };
      return body.data?.[0]?.id ?? null;
    },

    async phoneProfile(phoneNumberId, accessToken) {
      const params = new URLSearchParams({ fields: "display_phone_number,verified_name" });
      const body = (await request(`${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}?${params}`, {
        headers: auth(accessToken),
      }, "Phone profile")) as { display_phone_number?: string; verified_name?: string };
      return {
        displayPhone: (body.display_phone_number ?? "").replace(/\D/g, ""),
        displayName: body.verified_name ?? "",
      };
    },

    async businessVerified(wabaId, accessToken) {
      try {
        const params = new URLSearchParams({ fields: "business_verification_status" });
        const body = (await request(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}?${params}`, {
          headers: auth(accessToken),
        }, "Business verification")) as { business_verification_status?: string };
        return body.business_verification_status === "verified";
      } catch {
        // The field is not available for every business: show "pendiente" instead of failing the connect.
        return false;
      }
    },

    async sendText(phoneNumberId, accessToken, to, body) {
      const answer = (await request(`${GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { ...auth(accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      }, "Send text")) as { messages?: { id?: string }[] };
      const messageId = answer.messages?.[0]?.id;
      if (!messageId) throw new WhatsappApiError(null, "Send text without a message id");
      return { messageId };
    },
  };
}
