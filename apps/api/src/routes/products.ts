import { Hono } from "hono";
import { PRODUCT_PHOTO_MAX_BYTES, createProductSchema, updateProductSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
import { catalogServiceFor } from "../services/catalog";
import { domainErrorHandler, parseJsonBody, readUploadedFile, uploadBodyLimit } from "./http";

/** Products of the session's restaurant and their photos. */
export const productsRoutes = new Hono<AppEnv>()
  .use("*", requireSession)

  .post("/", async (c) => {
    const body = await parseJsonBody(c, createProductSchema);
    if ("response" in body) return body.response;
    const product = await catalogServiceFor(c.env.DB, c.env.MEDIA).createProduct(c.get("userId"), body.data);
    return c.json(product, 201);
  })

  .get("/:id", async (c) => {
    return c.json(await catalogServiceFor(c.env.DB, c.env.MEDIA).getProduct(c.get("userId"), c.req.param("id")));
  })

  .patch("/:id", async (c) => {
    const body = await parseJsonBody(c, updateProductSchema);
    if ("response" in body) return body.response;
    const product = await catalogServiceFor(c.env.DB, c.env.MEDIA).updateProduct(
      c.get("userId"),
      c.req.param("id"),
      body.data,
    );
    return c.json(product);
  })

  .delete("/:id", async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).deleteProduct(c.get("userId"), c.req.param("id"));
    return c.body(null, 204);
  })

  .put("/:id/photo", uploadBodyLimit("photo", PRODUCT_PHOTO_MAX_BYTES), async (c) => {
    const upload = await readUploadedFile(c, "photo");
    if ("response" in upload) return upload.response;
    const result = await catalogServiceFor(c.env.DB, c.env.MEDIA).uploadProductPhoto(c.get("userId"), c.req.param("id"), {
      bytes: await upload.file.arrayBuffer(),
      contentType: upload.file.type,
    });
    return c.json(result);
  })

  .delete("/:id/photo", async (c) => {
    await catalogServiceFor(c.env.DB, c.env.MEDIA).removeProductPhoto(c.get("userId"), c.req.param("id"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("products"));
