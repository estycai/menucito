import { Hono } from "hono";
import { dateRangeQuerySchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireCourier, requireMember } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { deliveriesServiceFor } from "../services/deliveries";
import { domainErrorHandler, parseQuery } from "./http";

/** "Mis repartos": the courier's own orders. Enabled by the `is_courier` mark, not by a permission. */
export const deliveriesRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requireCourier, async (c) => {
    const member = c.get("member");
    return c.json(await deliveriesServiceFor(c.env.DB).list(member.restaurantId, member.memberId));
  })

  .get("/summary", requireCourier, async (c) => {
    const query = parseQuery(c, dateRangeQuerySchema);
    if ("response" in query) return query.response;
    const member = c.get("member");
    return c.json(await deliveriesServiceFor(c.env.DB).summary(member.restaurantId, member.memberId, query.data));
  })

  .post("/:id/delivered", requireCourier, async (c) => {
    const member = c.get("member");
    const order = await deliveriesServiceFor(c.env.DB).markDelivered(
      member.restaurantId,
      member.memberId,
      c.req.param("id"),
    );
    return c.json(order);
  })

  .onError(domainErrorHandler("deliveries"));