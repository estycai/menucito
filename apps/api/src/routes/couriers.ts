import { Hono } from "hono";
import { courierSummaryQuerySchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { couriersServiceFor } from "../services/couriers";
import { domainErrorHandler, parseQuery } from "./http";

/** Courier picker (`orders.assign`) and the daily summary by courier (`couriers.view`). */
export const couriersRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requirePermission("orders.assign"), async (c) => {
    return c.json(await couriersServiceFor(c.env.DB).list(c.get("member").restaurantId));
  })

  .get("/summary", requirePermission("couriers.view"), async (c) => {
    const query = parseQuery(c, courierSummaryQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await couriersServiceFor(c.env.DB).summary(c.get("member").restaurantId, query.data));
  })

  .onError(domainErrorHandler("couriers"));