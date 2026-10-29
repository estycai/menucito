import { Hono } from "hono";
import { categoryInputSchema, reorderSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
import { catalogServiceFor } from "../services/catalog";
import { domainErrorHandler, parseJsonBody } from "./http";

/** Menu categories of the session's restaurant (and the catalog listing). */
export const categoriesRoutes = new Hono<AppEnv>()
  .use("*", requireSession)

  .get("/", async (c) => {
    return c.json(await catalogServiceFor(c.env.DB, c.env.MEDIA).getCatalog(c.get("userId")));
  })

  .post("/", async (c) => {
    const body = await parseJsonBody(c, categoryInputSchema);
    if ("response" in body) return body.response;
    const category = await catalogServiceFor(c.env.DB, c.env.MEDIA).createCategory(c.get("userId"), body.data.name);
    return c.json(category, 201);
  })

  .put("/order", async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    if ("response" in body) return body.response;
    await catalogServiceFor(c.env.DB, c.env.MEDIA).reorderCategories(c.get("userId"), body.data.ids);
    return c.body(null, 204);
  })

  .patch("/:id", async (c) => {
    const body = await parseJsonBody(c, categoryInputSchema);
    if ("response" in body) return body.response;
    const category = await catalogServiceFor(c.env.DB, c.env.MEDIA).renameCategory(
      c.get("userId"),
      c.req.param("id"),
      body.data.name,
    );
    return c.json(category);
  })

  .delete("/:id", async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).deleteCategory(c.get("userId"), c.req.param("id"));
    return c.body(null, 204);
  })

  .put("/:id/products/order", async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    if ("response" in body) return body.response;
    await catalogServiceFor(c.env.DB, c.env.MEDIA).reorderProducts(c.get("userId"), c.req.param("id"), body.data.ids);
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("categories"));
