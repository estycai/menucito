import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { WhatsappClient } from "../src/whatsapp/graph";
import { Client, ownerWithRestaurant, unique, type OwnerFixture } from "./helpers";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const BASE_PHONE = "5491155551234";
const SECRET = "app-secret";

function fakeClient(): WhatsappClient {
  return {
    exchangeCode: async () => ({ accessToken: "meta-token", expiresAt: null }),
    subscribeApp: async () => {},
    unsubscribeApp: async () => {},
    firstPhoneNumberId: async () => "phone-from-waba",
    phoneProfile: async () => ({ displayPhone: "5491100000000", displayName: "Lo de Marta" }),
    businessVerified: async () => true,
    sendText: async () => ({ messageId: "wamid-1" }),
  };
}

const bindings = (client: WhatsappClient): Partial<Env> => ({
  META_APP_ID: "app-id",
  META_APP_SECRET: SECRET,
  WHATSAPP_TOKEN_KEY: TOKEN_KEY,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
  WHATSAPP_CLIENT: client,
});

async function signature(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return `sha256=${Array.from(mac).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function postWebhook(client: Client, payload: unknown, signed = true): Promise<Response> {
  const raw = JSON.stringify(payload);
  return client.request("/api/webhooks/whatsapp", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      ...(signed ? { "X-Hub-Signature-256": await signature(raw) } : {}),
    },
  });
}

interface WebhookSetup {
  owner: OwnerFixture;
  client: Client;
  wabaId: string;
  phoneNumberId: string;
}

async function setup(): Promise<WebhookSetup> {
  const fake = fakeClient();
  const owner = await ownerWithRestaurant({ bindings: bindings(fake) });
  const category = (await (await owner.client.post("/api/categories", { name: "Burgers" })).json()) as { id: string };
  const product = (await (
    await owner.client.post("/api/products", {
      categoryId: category.id,
      name: "Hamburguesa",
      priceCents: 900_000,
      available: true,
    })
  ).json()) as { id: string };

  const wabaId = `waba-${unique()}`;
  const phoneNumberId = `phone-${unique()}`;
  expect(
    (
      await owner.client.post("/api/integrations/whatsapp/connect", {
        code: `code-${unique()}`,
        wabaId,
        phoneNumberId,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await owner.client.put("/api/order-messages", {
        templates: [{ fulfillment: "takeaway", targetStatus: "preparing", body: "Hola {nombre}, ya está listo" }],
      })
    ).status,
  ).toBe(200);
  const order = (await (
    await owner.client.post("/api/orders", {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555-1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      source: "local",
      whatsappConsent: true,
      clientOrderId: crypto.randomUUID(),
      expectedTotalCents: 900_000,
    })
  ).json()) as { id: string };
  // Open the 24-hour window without competing with the timestamps of the webhook test.
  await env.DB.prepare("UPDATE customers SET wa_last_inbound_at = ? WHERE restaurant_id = ? AND phone = ?")
    .bind(Date.now() - 120_000, owner.restaurantId, BASE_PHONE)
    .run();
  expect((await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" })).status).toBe(200);

  return { owner, client: new Client(bindings(fake)), wabaId, phoneNumberId };
}

const statusPayload = (setup: WebhookSetup, status: string, timestamp: number) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: setup.wabaId,
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: setup.phoneNumberId },
            statuses: [{ id: "wamid-1", status, timestamp: String(Math.floor(timestamp / 1000)) }],
          },
        },
      ],
    },
  ],
});

const notificationStatus = (restaurantId: string) =>
  env.DB.prepare("SELECT status, error_code FROM order_notifications WHERE restaurant_id = ?")
    .bind(restaurantId)
    .first<{ status: string; error_code: string | null }>();

describe("WhatsApp webhooks", () => {
  it("verifies the GET with the configured token", async () => {
    const fake = fakeClient();
    const client = new Client(bindings(fake));
    const ok = await client.get(
      "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc123");

    expect(
      (await client.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc")).status,
    ).toBe(403);
  });

  it("rejects a POST without a valid signature", async () => {
    const setupData = await setup();
    const res = await postWebhook(setupData.client, statusPayload(setupData, "delivered", Date.now()), false);
    expect(res.status).toBe(401);
    expect(await notificationStatus(setupData.owner.restaurantId)).toMatchObject({ status: "sent" });
  });

  it("advances sent -> delivered -> read and never goes backwards", async () => {
    const setupData = await setup();
    const restaurantId = setupData.owner.restaurantId;

    expect((await postWebhook(setupData.client, statusPayload(setupData, "delivered", Date.now()))).status).toBe(200);
    expect(await notificationStatus(restaurantId)).toMatchObject({ status: "delivered" });

    expect((await postWebhook(setupData.client, statusPayload(setupData, "read", Date.now()))).status).toBe(200);
    expect(await notificationStatus(restaurantId)).toMatchObject({ status: "read" });

    // Meta retries an older status: it changes nothing.
    expect((await postWebhook(setupData.client, statusPayload(setupData, "delivered", Date.now() - 1000))).status).toBe(200);
    expect(await notificationStatus(restaurantId)).toMatchObject({ status: "read" });
  });

  it("records when the customer writes and the per-business user id, never the content", async () => {
    const setupData = await setup();
    const at = Date.now();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: setupData.wabaId,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: setupData.phoneNumberId },
                contacts: [{ user_id: "bsuid-1", wa_id: BASE_PHONE }],
                messages: [{ from: BASE_PHONE, id: "in-1", timestamp: String(Math.floor(at / 1000)), type: "text", text: { body: "hola" } }],
              },
            },
          ],
        },
      ],
    };
    expect((await postWebhook(setupData.client, payload)).status).toBe(200);
    const customer = await env.DB.prepare(
      "SELECT wa_last_inbound_at, wa_bsuid FROM customers WHERE restaurant_id = ? AND phone = ?",
    )
      .bind(setupData.owner.restaurantId, BASE_PHONE)
      .first<{ wa_last_inbound_at: number; wa_bsuid: string }>();
    // Webhook timestamps are whole seconds.
    const atSeconds = Math.floor(at / 1000) * 1000;
    expect(customer?.wa_bsuid).toBe("bsuid-1");
    expect(customer?.wa_last_inbound_at).toBe(atSeconds);

    // Meta retries the same event: the newer timestamp is kept.
    const older = { ...payload, entry: [{ ...payload.entry[0], changes: [{ ...payload.entry[0]!.changes[0], value: { ...payload.entry[0]!.changes[0]!.value, messages: [{ from: BASE_PHONE, id: "in-1", timestamp: String(Math.floor((at - 60_000) / 1000)) }] } }] }] };
    expect((await postWebhook(setupData.client, older)).status).toBe(200);
    const again = await env.DB.prepare(
      "SELECT wa_last_inbound_at FROM customers WHERE restaurant_id = ? AND phone = ?",
    )
      .bind(setupData.owner.restaurantId, BASE_PHONE)
      .first<{ wa_last_inbound_at: number }>();
    expect(again?.wa_last_inbound_at).toBe(atSeconds);
  });

  it("marks the connection as failed when Meta reports an account problem", async () => {
    const setupData = await setup();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: setupData.wabaId,
          changes: [{ field: "account_update", value: { event: "ACCOUNT_DISABLED" } }],
        },
      ],
    };
    expect((await postWebhook(setupData.client, payload)).status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT status, status_detail FROM whatsapp_connections WHERE restaurant_id = ?",
    )
      .bind(setupData.owner.restaurantId)
      .first();
    expect(row).toEqual({ status: "error", status_detail: "ACCOUNT_DISABLED" });
  });
});
