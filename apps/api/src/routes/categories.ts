import { Hono } from "hono";
import { categoryInputSchema, featuredCategorySchema, reorderSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requirePermission, requireMember } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { catalogServiceFor } from "../services/catalog";
import { domainErrorHandler, parseJsonBody } from "./http";

/** Menu categories of the session's restaurant (and the catalog listing). */
export const categoriesRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .get("/", requirePermission("menu.view"), async (c) => {
    return c.json(await catalogServiceFor(c.env.DB, c.env.MEDIA).getCatalog(c.get("member").restaurantId));
  })

  .post("/", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, categoryInputSchema);
    if ("response" in body) return body.response;
    const category = await catalogServiceFor(c.env.DB, c.env.MEDIA).createCategory(c.get("member").restaurantId, body.data.name);
    return c.json(category, 201);
  })

  .put("/order", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    if ("response" in body) return body.response;
    await catalogServiceFor(c.env.DB, c.env.MEDIA).reorderCategories(c.get("member").restaurantId, body.data.ids);
    return c.body(null, 204);
  })

  .patch("/:id", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, categoryInputSchema);
    if ("response" in body) return body.response;
    const category = await catalogServiceFor(c.env.DB, c.env.MEDIA).renameCategory(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data.name,
    );
    return c.json(category);
  })

  .delete("/:id", requirePermission("menu.edit"), async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).deleteCategory(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .put("/:id/featured", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, featuredCategorySchema);
    if ("response" in body) return body.response;
    await catalogServiceFor(c.env.DB, c.env.MEDIA).setCategoryFeatured(c.get("member").restaurantId, c.req.param("id"), body.data.featured);
    return c.body(null, 204);
  })

  .put("/:id/products/order", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    if ("response" in body) return body.response;
    await catalogServiceFor(c.env.DB, c.env.MEDIA).reorderProducts(c.get("member").restaurantId, c.req.param("id"), body.data.ids);
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("categories"));
