import { Hono } from "hono";
import { roleSchema, updateRoleSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requireOwner } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { rolesServiceFor } from "../services/roles";
import { domainErrorHandler, parseJsonBody } from "./http";

/** Roles of the session's restaurant. Owner only. */
export const rolesRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requireOwner, async (c) => {
    return c.json(await rolesServiceFor(c.env.DB).list(c.get("member").restaurantId));
  })

  .post("/", requireOwner, async (c) => {
    const body = await parseJsonBody(c, roleSchema);
    if ("response" in body) return body.response;
    return c.json(await rolesServiceFor(c.env.DB).create(c.get("member").restaurantId, body.data), 201);
  })

  .patch("/:id", requireOwner, async (c) => {
    const body = await parseJsonBody(c, updateRoleSchema);
    if ("response" in body) return body.response;
    return c.json(await rolesServiceFor(c.env.DB).update(c.get("member").restaurantId, c.req.param("id"), body.data));
  })

  .delete("/:id", requireOwner, async (c) => {
    await rolesServiceFor(c.env.DB).remove(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("roles"));
