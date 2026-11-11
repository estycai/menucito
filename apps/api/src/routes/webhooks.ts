import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { createWhatsappRepository } from "../repositories/whatsapp";
import { createWhatsappWebhookService, validWebhookSignature } from "../services/whatsapp-webhook";
import { errorResponse } from "./http";

/** Meta payloads are small; the cap keeps an unauthenticated caller from buffering megabytes. */
const webhookBodyLimit = bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => errorResponse(c as Context<AppEnv>, 413, "BODY_TOO_LARGE", "El cuerpo supera el límite permitido"),
});

/**
 * Public webhooks of Meta. They carry no member guard: Meta calls them with the app secret's
 * signature, and the verification GET answers with the configured token.
 */
export const whatsappWebhookRoutes = new Hono<AppEnv>()
  .get("/whatsapp", (c) => {
    const verifyToken = c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) return errorResponse(c, 503, "WHATSAPP_UNAVAILABLE", "WhatsApp no está disponible");
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge") ?? "";
    if (mode === "subscribe" && token === verifyToken) return c.text(challenge);
    return errorResponse(c, 403, "FORBIDDEN", "Verificación inválida");
  })

  .post("/whatsapp", webhookBodyLimit, async (c) => {
    const secret = c.env.META_APP_SECRET;
    if (!secret) return errorResponse(c, 503, "WHATSAPP_UNAVAILABLE", "WhatsApp no está disponible");
    const rawBody = await c.req.text();
    if (!(await validWebhookSignature(rawBody, c.req.header("X-Hub-Signature-256"), secret))) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Firma inválida");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return errorResponse(c, 400, "VALIDATION_ERROR", "JSON inválido");
    }
    // Answer 200 at once: Meta retries for up to 7 days, and the work is idempotent.
    const task = createWhatsappWebhookService(createWhatsappRepository(c.env.DB)).process(payload);
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      // No execution context (unit tests): await it instead.
      await task;
    }
    return c.text("ok");
  });
