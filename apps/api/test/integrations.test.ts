import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { decryptToken } from "../src/whatsapp/crypto";
import { WhatsappApiError, type WhatsappClient } from "../src/whatsapp/graph";
import { errorCode, ownerWithRestaurant, staffClient, unique, type OwnerFixture } from "./helpers";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function fakeClient() {
  const calls = { subscribe: 0, unsubscribe: 0 };
  const client: WhatsappClient = {
    exchangeCode: async () => ({ accessToken: "meta-token", expiresAt: null }),
    subscribeApp: async () => {
      calls.subscribe += 1;
    },
    unsubscribeApp: async () => {
      calls.unsubscribe += 1;
    },
    firstPhoneNumberId: async () => "phone-from-waba",
    phoneProfile: async () => ({ displayPhone: "5491100000000", displayName: "Lo de Marta" }),
    businessVerified: async () => true,
    sendText: async () => ({ messageId: "wamid-1" }),
  };
  return { client, calls };
}

const bindings = (client: WhatsappClient): Partial<Env> => ({
  META_APP_ID: "app-id",
  META_APP_SECRET: "app-secret",
  META_ES_CONFIG_ID: "config-id",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
  WHATSAPP_TOKEN_KEY: TOKEN_KEY,
  WHATSAPP_CLIENT: client,
});

async function connect(owner: OwnerFixture, phoneNumberId = `phone-${unique()}`) {
  return owner.client.post("/api/integrations/whatsapp/connect", {
    code: `code-${unique()}`,
    wabaId: `waba-${unique()}`,
    phoneNumberId,
  });
}

describe("GET /api/integrations/whatsapp", () => {
  it("answers 503 WHATSAPP_UNAVAILABLE without a Meta app", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const owner = await ownerWithRestaurant();
    const res = await owner.client.get("/api/integrations/whatsapp");
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("WHATSAPP_UNAVAILABLE");
  });

  it("starts without a connection and zero notices", async () => {
    const { client } = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(client) });
    const res = await owner.client.get("/api/integrations/whatsapp");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connection: null,
      stats: { sent: 0, free: 0, failed: 0 },
    });
  });
});

describe("connecting and disconnecting a local", () => {
  it("subscribes the app, stores the token encrypted and shows the number", async () => {
    const fake = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(fake.client) });

    const res = await connect(owner);
    expect(res.status).toBe(201);
    expect((await res.json()) as object).toMatchObject({
      connection: {
        status: "connected",
        displayPhone: "5491100000000",
        displayName: "Lo de Marta",
        businessVerified: true,
        coexistence: true,
        autoSend: true,
        statusDetail: null,
      },
    });
    expect(fake.calls.subscribe).toBe(1);

    const row = await env.DB.prepare(
      "SELECT access_token_enc, access_token_enc = 'meta-token' AS plain FROM whatsapp_connections WHERE restaurant_id = ?",
    )
      .bind(owner.restaurantId)
      .first<{ access_token_enc: string; plain: number }>();
    expect(row?.access_token_enc).toBeTruthy();
    expect(row?.plain).toBe(0);
    expect(await decryptToken(TOKEN_KEY, row!.access_token_enc)).toBe("meta-token");
  });

  it("reads the number from the WABA when coexistence only reports the WABA", async () => {
    const fake = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(fake.client) });
    const res = await owner.client.post("/api/integrations/whatsapp/connect", {
      code: `code-${unique()}`,
      wabaId: `waba-${unique()}`,
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT phone_number_id FROM whatsapp_connections WHERE restaurant_id = ?")
      .bind(owner.restaurantId)
      .first<{ phone_number_id: string }>();
    expect(row?.phone_number_id).toBe("phone-from-waba");
  });

  it("turns the automatic switch off and on", async () => {
    const { client } = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(client) });
    await connect(owner);

    const off = await owner.client.patch("/api/integrations/whatsapp", { autoSend: false });
    expect(off.status).toBe(200);
    expect((await off.json()) as { connection: { autoSend: boolean } }).toMatchObject({ connection: { autoSend: false } });

    const on = await owner.client.patch("/api/integrations/whatsapp", { autoSend: true });
    expect((await on.json()) as { connection: { autoSend: boolean } }).toMatchObject({ connection: { autoSend: true } });
  });

  it("unsubscribes the app, clears the token and keeps the notices", async () => {
    const fake = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(fake.client) });
    await connect(owner);

    const res = await owner.client.delete("/api/integrations/whatsapp");
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ connection: { status: "disconnected" } });
    expect(fake.calls.unsubscribe).toBe(1);

    const row = await env.DB.prepare(
      "SELECT access_token_enc, status FROM whatsapp_connections WHERE restaurant_id = ?",
    )
      .bind(owner.restaurantId)
      .first();
    expect(row).toEqual({ access_token_enc: null, status: "disconnected" });
  });

  it("refuses to link a phone number already connected in another local", async () => {
    const { client } = fakeClient();
    const a = await ownerWithRestaurant({ bindings: bindings(client) });
    const b = await ownerWithRestaurant({ bindings: bindings(client) });
    const phoneNumberId = `phone-${unique()}`;

    expect((await connect(a, phoneNumberId)).status).toBe(201);
    const res = await connect(b, phoneNumberId);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("WHATSAPP_PHONE_IN_USE");
  });

  it("turns a Meta failure into WHATSAPP_ERROR without storing a connection", async () => {
    const failing: WhatsappClient = {
      ...fakeClient().client,
      exchangeCode: async () => {
        throw new WhatsappApiError(190, "expired");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = await ownerWithRestaurant({ bindings: bindings(failing) });
    const res = await connect(owner);
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe("WHATSAPP_ERROR");
    expect(
      await env.DB.prepare("SELECT restaurant_id FROM whatsapp_connections WHERE restaurant_id = ?")
        .bind(owner.restaurantId)
        .first(),
    ).toBeNull();
  });
});

describe("permissions and tenant isolation", () => {
  it("lets integrations.view read and only integrations.edit connect or configure", async () => {
    const { client } = fakeClient();
    const owner = await ownerWithRestaurant({ bindings: bindings(client) });
    const staff = await staffClient({ owner, permissions: ["integrations.view"], bindings: bindings(client) });

    expect((await staff.client.get("/api/integrations/whatsapp")).status).toBe(200);
    expect((await staff.client.patch("/api/integrations/whatsapp", { autoSend: false })).status).toBe(403);
    const denied = await staff.client.post("/api/integrations/whatsapp/connect", {
      code: "code",
      wabaId: "waba",
      phoneNumberId: "phone",
    });
    expect(denied.status).toBe(403);
  });

  it("never shows the connection of another local", async () => {
    const { client } = fakeClient();
    const a = await ownerWithRestaurant({ bindings: bindings(client) });
    const b = await ownerWithRestaurant({ bindings: bindings(client) });
    await connect(a);

    const res = await b.client.get("/api/integrations/whatsapp");
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ connection: null });
  });
});
