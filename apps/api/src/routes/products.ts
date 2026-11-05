import { Hono } from "hono";
import {
  PRODUCT_PHOTO_MAX_BYTES,
  createProductSchema,
  replaceIngredientsSchema,
  updateProductSchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { requirePermission, requireMember } from "../middleware/require-member";
import { requireSession } from "../middleware/require-session";
import { catalogServiceFor } from "../services/catalog";
import { domainErrorHandler, parseJsonBody, readUploadedFile, uploadBodyLimit } from "./http";

/** Products of the session's restaurant and their photos. */
export const productsRoutes = new Hono<AppEnv>()
  .use("*", requireSession, requireMember)

  .post("/", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, createProductSchema);
    if ("response" in body) return body.response;
    const product = await catalogServiceFor(c.env.DB, c.env.MEDIA).createProduct(c.get("member").restaurantId, body.data);
    return c.json(product, 201);
  })

  .get("/:id", requirePermission("menu.view"), async (c) => {
    return c.json(await catalogServiceFor(c.env.DB, c.env.MEDIA).getProduct(c.get("member").restaurantId, c.req.param("id")));
  })

  .patch("/:id", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, updateProductSchema);
    if ("response" in body) return body.response;
    const product = await catalogServiceFor(c.env.DB, c.env.MEDIA).updateProduct(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data,
    );
    return c.json(product);
  })

  .delete("/:id", requirePermission("menu.edit"), async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).deleteProduct(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .put("/:id/ingredients", requirePermission("menu.edit"), async (c) => {
    const body = await parseJsonBody(c, replaceIngredientsSchema);
    if ("response" in body) return body.response;
    const ingredients = await catalogServiceFor(c.env.DB, c.env.MEDIA).replaceIngredients(
      c.get("member").restaurantId,
      c.req.param("id"),
      body.data.ingredients,
    );
    return c.json({ ingredients });
  })

  .put("/:id/photo", requirePermission("menu.edit"), uploadBodyLimit("photo", PRODUCT_PHOTO_MAX_BYTES), async (c) => {
    const upload = await readUploadedFile(c, "photo");
    if ("response" in upload) return upload.response;
    const result = await catalogServiceFor(c.env.DB, c.env.MEDIA).uploadProductPhoto(c.get("member").restaurantId, c.req.param("id"), {
      bytes: await upload.file.arrayBuffer(),
      contentType: upload.file.type,
    });
    return c.json(result);
  })

  .delete("/:id/photo", requirePermission("menu.edit"), async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).removeProductPhoto(c.get("member").restaurantId, c.req.param("id"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("products"));
