import { Hono } from "hono";
import { whatsappAutoSendSchema, whatsappConnectSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { whatsappIntegrationsFor } from "../services/integrations";
import { domainErrorHandler, parseJsonBody } from "./http";

export const integrationsRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/whatsapp", requirePermission("integrations.view"), async (c) => {
    return c.json(await whatsappIntegrationsFor(c.env).get(c.get("member").restaurantId));
  })

  .post("/whatsapp/connect", requirePermission("integrations.edit"), async (c) => {
    const body = await parseJsonBody(c, whatsappConnectSchema);
    if ("response" in body) return body.response;
    const connection = await whatsappIntegrationsFor(c.env).connect(c.get("member").restaurantId, body.data);
    return c.json({ connection }, 201);
  })

  .patch("/whatsapp", requirePermission("integrations.edit"), async (c) => {
    const body = await parseJsonBody(c, whatsappAutoSendSchema);
    if ("response" in body) return body.response;
    return c.json(await whatsappIntegrationsFor(c.env).setAutoSend(c.get("member").restaurantId, body.data));
  })

  .delete("/whatsapp", requirePermission("integrations.edit"), async (c) => {
    return c.json(await whatsappIntegrationsFor(c.env).disconnect(c.get("member").restaurantId));
  })

  .onError(domainErrorHandler("integrations"));
