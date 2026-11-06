import { Hono } from "hono";
import { orderMessageTemplatesSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { orderMessagesServiceFor } from "../services/order-messages";
import { domainErrorHandler, parseJsonBody } from "./http";

/** Mounted at `/api/order-messages` so it does not collide with `GET /api/orders/:id`. */
export const orderMessagesRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requirePermission("orders.settings"), async (c) => {
    const templates = await orderMessagesServiceFor(c.env.DB).list(c.get("member").restaurantId);
    return c.json({ templates });
  })

  .put("/", requirePermission("orders.settings"), async (c) => {
    const body = await parseJsonBody(c, orderMessageTemplatesSchema);
    if ("response" in body) return body.response;
    return c.json(await orderMessagesServiceFor(c.env.DB).replace(c.get("member").restaurantId, body.data));
  })

  .onError(domainErrorHandler("order-messages"));
