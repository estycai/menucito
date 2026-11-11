import { Hono } from "hono";
import { customerTagInputSchema, updateCustomerTagSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireMember, requirePermission } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { customersServiceFor } from "../services/customers";
import { domainErrorHandler, parseJsonBody } from "./http";

/** Tags of the local (change 17a): create, rename/recolor and delete. */
export const customerTagsRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requirePermission("customers.view"), async (c) => {
    return c.json(await customersServiceFor(c.env).listTags(c.get("member").restaurantId));
  })

  .post("/", requirePermission("customers.edit"), async (c) => {
    const body = await parseJsonBody(c, customerTagInputSchema);
    if ("response" in body) return body.response;
    return c.json(await customersServiceFor(c.env).createTag(c.get("member").restaurantId, body.data), 201);
  })

  .patch("/:id", requirePermission("customers.edit"), async (c) => {
    const body = await parseJsonBody(c, updateCustomerTagSchema);
    if ("response" in body) return body.response;
    return c.json(
      await customersServiceFor(c.env).updateTag(
        c.get("member").restaurantId,
        c.req.param("id"),
        body.data,
      ),
    );
  })

  .delete("/:id", requirePermission("customers.edit"), async (c) => {
    await customersServiceFor(c.env).deleteTag(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("customer-tags"));
