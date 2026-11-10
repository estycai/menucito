import { Hono } from "hono";
import { reportFiltersSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { reportsServiceFor } from "../services/reports";
import { domainErrorHandler, parseQuery } from "./http";

/** Reports: the filter metadata and one route per tab (16a starts with Evolución). */
export const reportsRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/meta", requirePermission("stats.view"), async (c) => {
    return c.json(await reportsServiceFor(c.env.DB).meta(c.get("member").restaurantId));
  })

  .get("/evolution", requirePermission("stats.tab.evolution"), async (c) => {
    const query = parseQuery(c, reportFiltersSchema);
    if ("response" in query) return query.response;
    const member = c.get("member");
    return c.json(await reportsServiceFor(c.env.DB).evolution(member.restaurantId, member, query.data));
  })

  .onError(domainErrorHandler("reports"));
