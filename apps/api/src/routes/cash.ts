import { Hono } from "hono";
import {
  cashHistoryQuerySchema,
  closeCashSessionSchema,
  createCashMovementSchema,
  giveCourierChangeSchema,
  hasPermission,
  openCashSessionSchema,
  settleOrdersSchema,
  updateCashMovementSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { cashServiceFor } from "../services/cash";
import { domainErrorHandler, parseJsonBody, parseQuery } from "./http";

const ok = { ok: true } as const;

/** Cash drawer: current session, movements, settlements, close and history. */
export const cashRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/current", requirePermission("cash.view"), async (c) => {
    const member = c.get("member");
    return c.json(
      await cashServiceFor(c.env.DB).current(member.restaurantId, hasPermission(member, "cash.expected")),
    );
  })

  .post("/", requirePermission("cash.open"), async (c) => {
    const body = await parseJsonBody(c, openCashSessionSchema);
    if ("response" in body) return body.response;
    const session = await cashServiceFor(c.env.DB).open(c.get("member").restaurantId, c.get("member"), body.data);
    return c.json(session, 201);
  })

  .post("/current/movements", requirePermission("cash.movements"), async (c) => {
    const body = await parseJsonBody(c, createCashMovementSchema);
    if ("response" in body) return body.response;
    await cashServiceFor(c.env.DB).createMovement(c.get("member").restaurantId, c.get("member"), body.data);
    return c.json(ok, 201);
  })

  .patch("/current/movements/:id", requirePermission("cash.movements"), async (c) => {
    const body = await parseJsonBody(c, updateCashMovementSchema);
    if ("response" in body) return body.response;
    await cashServiceFor(c.env.DB).editMovement(
      c.get("member").restaurantId,
      c.get("member"),
      c.req.param("id"),
      body.data,
    );
    return c.json(ok);
  })

  .post("/current/movements/:id/void", requirePermission("cash.movements"), async (c) => {
    await cashServiceFor(c.env.DB).voidMovement(c.get("member").restaurantId, c.get("member"), c.req.param("id"));
    return c.json(ok);
  })

  .post("/current/settlements", requirePermission("cash.settle"), async (c) => {
    const body = await parseJsonBody(c, settleOrdersSchema);
    if ("response" in body) return body.response;
    await cashServiceFor(c.env.DB).settle(c.get("member").restaurantId, c.get("member"), body.data);
    return c.json(ok, 201);
  })

  .delete("/current/settlements/:orderId", requirePermission("cash.settle"), async (c) => {
    await cashServiceFor(c.env.DB).unsettle(c.get("member").restaurantId, c.req.param("orderId"));
    return c.body(null, 204);
  })

  .post("/current/courier-change", requirePermission("cash.settle"), async (c) => {
    const body = await parseJsonBody(c, giveCourierChangeSchema);
    if ("response" in body) return body.response;
    await cashServiceFor(c.env.DB).giveChange(c.get("member").restaurantId, c.get("member"), body.data);
    return c.json(ok, 201);
  })

  .post("/current/close", requirePermission("cash.close"), async (c) => {
    const body = await parseJsonBody(c, closeCashSessionSchema);
    if ("response" in body) return body.response;
    return c.json(await cashServiceFor(c.env.DB).close(c.get("member").restaurantId, c.get("member"), body.data));
  })

  .get("/", requirePermission("cash.history"), async (c) => {
    const query = parseQuery(c, cashHistoryQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await cashServiceFor(c.env.DB).history(c.get("member").restaurantId, query.data));
  })

  .get("/:id", requirePermission("cash.history"), async (c) => {
    return c.json(await cashServiceFor(c.env.DB).detail(c.get("member").restaurantId, c.req.param("id")));
  })

  .onError(domainErrorHandler("cash"));
