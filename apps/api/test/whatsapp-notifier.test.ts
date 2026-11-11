import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { OrderDetail, OrderMessageTemplate } from "@menucito/shared";
import type { Env } from "../src/env";
import { createOrderMessagesRepository } from "../src/repositories/order-messages";
import { createOrdersRepository } from "../src/repositories/orders";
import { createWhatsappRepository } from "../src/repositories/whatsapp";
import { createWhatsappNotifier } from "../src/services/whatsapp-notifier";
import { WhatsappApiError, type WhatsappClient } from "../src/whatsapp/graph";
import { errorCode, ownerWithRestaurant, staffClient, unique, type OwnerFixture } from "./helpers";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const BASE_PHONE = "5491155551234";

interface FakeClient {
  client: WhatsappClient;
  sent: { to: string; body: string }[];
  failSend: boolean;
}

function fakeClient(): FakeClient {
  const fake: FakeClient = {
    sent: [],
    failSend: false,
    client: {
      exchangeCode: async () => ({ accessToken: "meta-token", expiresAt: null }),
      subscribeApp: async () => {},
      unsubscribeApp: async () => {},
      firstPhoneNumberId: async () => "phone-from-waba",
      phoneProfile: async () => ({ displayPhone: "5491100000000", displayName: "Lo de Marta" }),
      businessVerified: async () => true,
      sendText: async (_phoneNumberId, _token, to, body) => {
        if (fake.failSend) throw new WhatsappApiError(131026, "undeliverable");
        fake.sent.push({ to, body });
        return { messageId: `wamid-${fake.sent.length}` };
      },
    },
  };
  return fake;
}

const bindings = (fake: FakeClient): Partial<Env> => ({
  META_APP_ID: "app-id",
  META_APP_SECRET: "app-secret",
  META_ES_CONFIG_ID: "config-id",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
  WHATSAPP_TOKEN_KEY: TOKEN_KEY,
  WHATSAPP_CLIENT: fake.client,
});

async function createCatalog(owner: OwnerFixture) {
  const category = (await (await owner.client.post("/api/categories", { name: "Burgers" })).json()) as { id: string };
  return (await (
    await owner.client.post("/api/products", {
      categoryId: category.id,
      name: "Hamburguesa",
      priceCents: 900_000,
      available: true,
    })
  ).json()) as { id: string };
}

async function setup(fake = fakeClient()) {
  const owner = await ownerWithRestaurant({ bindings: bindings(fake) });
  const product = await createCatalog(owner);
  return { owner, product, fake };
}

async function connect(owner: OwnerFixture) {
  const res = await owner.client.post("/api/integrations/whatsapp/connect", {
    code: `code-${unique()}`,
    wabaId: `waba-${unique()}`,
    phoneNumberId: `phone-${unique()}`,
  });
  expect(res.status).toBe(201);
}

async function saveTemplate(owner: OwnerFixture, targetStatus: OrderMessageTemplate["targetStatus"] = "preparing") {
  const res = await owner.client.put("/api/order-messages", {
    templates: [
      {
        fulfillment: "takeaway",
        targetStatus,
        body: "Hola {nombre}, el pedido #{numero} de {local} pasó a {estado}. Total {total}",
      },
    ],
  });
  expect(res.status).toBe(200);
}

async function createOrder(owner: OwnerFixture, productId: string, whatsappConsent = true): Promise<OrderDetail> {
  const res = await owner.client.post("/api/orders", {
    items: [{ productId, quantity: 1 }],
    customer: { name: "Juan Pérez", phone: "11 5555-1234" },
    fulfillment: "takeaway",
    paymentMethod: "cash",
    source: "local",
    whatsappConsent,
    clientOrderId: crypto.randomUUID(),
    expectedTotalCents: 900_000,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as OrderDetail;
}

const notificationRow = (restaurantId: string, orderId: string, targetStatus = "preparing") =>
  env.DB.prepare(
    "SELECT * FROM order_notifications WHERE restaurant_id = ? AND order_id = ? AND target_status = ?",
  )
    .bind(restaurantId, orderId, targetStatus)
    .first<{
      id: string;
      channel: string;
      status: string;
      body: string;
      error_code: string | null;
      error_message: string | null;
      wa_message_id: string | null;
    }>();

async function openWindow(restaurantId: string, at = Date.now()) {
  await env.DB.prepare("UPDATE customers SET wa_last_inbound_at = ? WHERE restaurant_id = ? AND phone = ?")
    .bind(at, restaurantId, BASE_PHONE)
    .run();
}

describe("whatsapp notifier: decision table", () => {
  it("does nothing without a connection, with auto-send off or without a message for the transition", async () => {
    const { owner, product } = await setup();
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await openWindow(owner.restaurantId);

    // No connection.
    expect((await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" })).status).toBe(200);
    expect(await notificationRow(owner.restaurantId, order.id)).toBeNull();

    // Connection but the switch is off.
    await connect(owner);
    await owner.client.patch("/api/integrations/whatsapp", { autoSend: false });
    const second = await createOrder(owner, product.id, false);
    expect((await owner.client.patch(`/api/orders/${second.id}/status`, { status: "preparing" })).status).toBe(200);
    expect(await notificationRow(owner.restaurantId, second.id)).toBeNull();

    // Connection on, but no message written for the transition.
    await owner.client.patch("/api/integrations/whatsapp", { autoSend: true });
    const noTemplate = await createOrder(owner, product.id);
    expect((await owner.client.patch(`/api/orders/${noTemplate.id}/status`, { status: "ready" })).status).toBe(200);
    expect(await notificationRow(owner.restaurantId, noTemplate.id, "ready")).toBeNull();
  });

  it("skips a customer without permission or with opt-out, and shows it in the history without a badge", async () => {
    const { owner, product } = await setup();
    await connect(owner);
    await saveTemplate(owner);

    const withoutConsent = await createOrder(owner, product.id, false);
    expect((await owner.client.patch(`/api/orders/${withoutConsent.id}/status`, { status: "preparing" })).status).toBe(200);
    expect(await notificationRow(owner.restaurantId, withoutConsent.id)).toMatchObject({ status: "skipped" });

    const optedOut = await createOrder(owner, product.id, true);
    await env.DB.prepare("UPDATE customers SET whatsapp_opt_out = 1 WHERE restaurant_id = ? AND phone = ?")
      .bind(owner.restaurantId, BASE_PHONE)
      .run();
    expect((await owner.client.patch(`/api/orders/${optedOut.id}/status`, { status: "preparing" })).status).toBe(200);
    expect(await notificationRow(owner.restaurantId, optedOut.id)).toMatchObject({ status: "skipped" });

    const list = (await (await owner.client.get("/api/orders?status=active")).json()) as {
      orders: { id: string; notificationAlert: string | null }[];
    };
    expect(list.orders.find((order) => order.id === withoutConsent.id)?.notificationAlert).toBeNull();
  });

  it("sends free text when the window is open, with the message rendered", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await openWindow(owner.restaurantId);

    const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" });
    expect(res.status).toBe(200);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toEqual({
      to: BASE_PHONE,
      body: "Hola Juan Pérez, el pedido #1 de Lo de Marta pasó a {estado}. Total $9.000",
    });
    expect(await notificationRow(owner.restaurantId, order.id)).toMatchObject({
      channel: "text",
      status: "sent",
      wa_message_id: "wamid-1",
    });

    const integration = (await (await owner.client.get("/api/integrations/whatsapp")).json()) as {
      stats: { sent: number; free: number; failed: number };
    };
    expect(integration.stats).toEqual({ sent: 1, free: 1, failed: 0 });
  });

  it("leaves pending_manual without sending when the window is closed, and never uses a template", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);

    expect((await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" })).status).toBe(200);
    expect(fake.sent).toHaveLength(0);
    expect(await notificationRow(owner.restaurantId, order.id)).toMatchObject({
      channel: "manual",
      status: "pending_manual",
      wa_message_id: null,
    });

    const list = (await (await owner.client.get("/api/orders?status=active")).json()) as {
      orders: { id: string; notificationAlert: string | null; whatsappWindowOpen: boolean; whatsappOptIn: boolean }[];
    };
    expect(list.orders[0]).toMatchObject({
      id: order.id,
      notificationAlert: "pending_manual",
      whatsappWindowOpen: false,
      whatsappOptIn: true,
    });

    const detail = (await (await owner.client.get(`/api/orders/${order.id}`)).json()) as {
      whatsappWindowOpen: boolean;
      whatsappOptIn: boolean;
    };
    expect(detail).toMatchObject({ whatsappWindowOpen: false, whatsappOptIn: true });
  });

  it("answers 200 even when Meta fails, and stores the failure with a Spanish reason", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await openWindow(owner.restaurantId);
    fake.failSend = true;

    const res = await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" });
    expect(res.status).toBe(200);
    expect(await notificationRow(owner.restaurantId, order.id)).toMatchObject({
      status: "failed",
      error_code: "131026",
      error_message: "El cliente no puede recibir mensajes de WhatsApp en ese número.",
    });

    const list = (await (await owner.client.get("/api/orders?status=active")).json()) as {
      orders: { notificationAlert: string | null }[];
    };
    expect(list.orders[0]?.notificationAlert).toBe("failed");

    const integration = (await (await owner.client.get("/api/integrations/whatsapp")).json()) as {
      stats: { sent: number; free: number; failed: number };
    };
    expect(integration.stats).toEqual({ sent: 0, free: 0, failed: 1 });
  });

  it("creates one notice at most for the same order and transition", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await openWindow(owner.restaurantId);

    const notifier = createWhatsappNotifier({
      repo: createWhatsappRepository(env.DB),
      orders: createOrdersRepository(env.DB),
      orderMessages: createOrderMessagesRepository(env.DB),
      client: fake.client,
      tokenKey: TOKEN_KEY,
    });
    await notifier.onStatusChanged(owner.restaurantId, order, "preparing");
    await notifier.onStatusChanged(owner.restaurantId, order, "preparing");

    expect(fake.sent).toHaveLength(1);
    const count = await env.DB.prepare(
      "SELECT count(*) AS count FROM order_notifications WHERE restaurant_id = ? AND order_id = ?",
    )
      .bind(owner.restaurantId, order.id)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});

describe("whatsapp notices: history, retry and manual", () => {
  it("lists the history, retries by Meta and marks a manual send", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await openWindow(owner.restaurantId);
    fake.failSend = true;
    await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" });

    const history = (await (await owner.client.get(`/api/orders/${order.id}/notifications`)).json()) as {
      notifications: { id: string; status: string; targetStatus: string }[];
    };
    expect(history.notifications).toHaveLength(1);
    expect(history.notifications[0]).toMatchObject({ status: "failed", targetStatus: "preparing" });
    const notificationId = history.notifications[0]!.id;

    fake.failSend = false;
    const retried = await owner.client.post(`/api/orders/${order.id}/notifications/${notificationId}/retry`, {});
    expect(retried.status).toBe(200);
    expect((await retried.json()) as object).toMatchObject({ status: "sent", channel: "text" });

    const manual = await owner.client.post(`/api/orders/${order.id}/notifications/${notificationId}/manual`, {});
    expect(manual.status).toBe(200);
    expect((await manual.json()) as object).toMatchObject({ status: "sent", channel: "manual", waMessageId: null });
  });

  it("needs orders.status to retry and mark manual; orders.view can read the history", async () => {
    const { owner, product } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const order = await createOrder(owner, product.id);
    await owner.client.patch(`/api/orders/${order.id}/status`, { status: "preparing" });
    const history = (await (await owner.client.get(`/api/orders/${order.id}/notifications`)).json()) as {
      notifications: { id: string }[];
    };
    const notificationId = history.notifications[0]!.id;

    const staff = await staffClient({ owner, permissions: ["orders.view"] });
    expect((await staff.client.get(`/api/orders/${order.id}/notifications`)).status).toBe(200);
    const retry = await staff.client.post(`/api/orders/${order.id}/notifications/${notificationId}/retry`, {});
    expect(retry.status).toBe(403);
    expect(await errorCode(retry)).toBe("FORBIDDEN");
  });

  it("serves the notice config of the orders screen with orders.view", async () => {
    const { owner, fake } = await setup();
    await connect(owner);
    await saveTemplate(owner);
    const staff = await staffClient({ owner, permissions: ["orders.view"], bindings: bindings(fake) });
    const res = await staff.client.get("/api/orders/whatsapp-config");
    expect(res.status).toBe(200);
    const config = (await res.json()) as { available: boolean; connected: boolean; autoSend: boolean; templates: unknown[] };
    expect(config).toMatchObject({ available: true, connected: true, autoSend: true });
    expect(config.templates).toHaveLength(1);
  });
});

describe("whatsapp notifier: the courier's delivery", () => {
  it("notifies when the courier marks the order delivered from Mis repartos", async () => {
    const { owner, product, fake } = await setup();
    await connect(owner);
    const templates = await owner.client.put("/api/order-messages", {
      templates: [{ fulfillment: "delivery", targetStatus: "delivered", body: "Entregado #{numero}" }],
    });
    expect(templates.status).toBe(200);
    const created = await owner.client.post("/api/orders", {
      items: [{ productId: product.id, quantity: 1 }],
      customer: { name: "Juan Pérez", phone: "11 5555-1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      source: "local",
      whatsappConsent: true,
      clientOrderId: crypto.randomUUID(),
      expectedTotalCents: 900_000,
    });
    expect(created.status).toBe(201);
    const order = (await created.json()) as OrderDetail;
    await openWindow(owner.restaurantId);

    const courier = await staffClient({ permissions: [], owner, isCourier: true, bindings: bindings(fake) });
    expect((await owner.client.patch(`/api/orders/${order.id}/status`, { status: "ready" })).status).toBe(200);
    expect((await owner.client.post(`/api/orders/${order.id}/assign`, { courierMemberId: courier.memberId })).status).toBe(200);
    expect((await courier.client.post(`/api/deliveries/${order.id}/delivered`, {})).status).toBe(200);

    expect(await notificationRow(owner.restaurantId, order.id, "delivered")).toMatchObject({
      channel: "text",
      status: "sent",
      body: `Entregado #${order.number}`,
    });
    expect(fake.sent).toEqual([{ to: BASE_PHONE, body: `Entregado #${order.number}` }]);
  });
});
