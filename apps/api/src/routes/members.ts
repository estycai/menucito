import { Hono } from "hono";
import {
  createMemberSchema,
  memberListQuerySchema,
  setMemberActiveSchema,
  setMemberPasswordSchema,
  updateMemberSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requireOwner } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { membersServiceFor } from "../services/members";
import { domainErrorHandler, parseJsonBody, parseQuery } from "./http";

/** People with access to the session's restaurant. Owner only (not a permission anyone can be given). */
export const membersRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requireOwner, async (c) => {
    const query = parseQuery(c, memberListQuerySchema);
    if ("response" in query) return query.response;
    return c.json(await (await membersServiceFor(c.env)).list(c.get("member").restaurantId, query.data));
  })

  .post("/", requireOwner, async (c) => {
    const body = await parseJsonBody(c, createMemberSchema);
    if ("response" in body) return body.response;
    const member = await (await membersServiceFor(c.env)).create(c.get("member").restaurantId, body.data);
    return c.json(member, 201);
  })

  .patch("/:id", requireOwner, async (c) => {
    const body = await parseJsonBody(c, updateMemberSchema);
    if ("response" in body) return body.response;
    const member = await (await membersServiceFor(c.env)).update(c.get("member").restaurantId, c.req.param("id"), body.data);
    return c.json(member);
  })

  .patch("/:id/active", requireOwner, async (c) => {
    const body = await parseJsonBody(c, setMemberActiveSchema);
    if ("response" in body) return body.response;
    const member = await (await membersServiceFor(c.env)).setActive(c.get("member").restaurantId, c.req.param("id"), body.data.active);
    return c.json(member);
  })

  .put("/:id/password", requireOwner, async (c) => {
    const body = await parseJsonBody(c, setMemberPasswordSchema);
    if ("response" in body) return body.response;
    await (await membersServiceFor(c.env)).setPassword(c.get("member").restaurantId, c.req.param("id"), body.data.password);
    return c.body(null, 204);
  })

  .delete("/:id", requireOwner, async (c) => {
    await (await membersServiceFor(c.env)).remove(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("members"));
