import { Hono } from "hono";
import { LOGO_MAX_BYTES, createRestaurantSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
import { logoServiceFor } from "../services/logos";
import { restaurantsServiceFor } from "../services/restaurants";
import { domainErrorHandler, parseJsonBody, readUploadedFile, uploadBodyLimit } from "./http";

export const restaurantsRoutes = new Hono<AppEnv>()
  .use("*", requireSession)

  .get("/me", async (c) => {
    const restaurant = await restaurantsServiceFor(c.env.DB).getMine(c.get("userId"));
    return c.json(restaurant);
  })

  .get("/slug-available", async (c) => {
    const slug = c.req.query("slug") ?? "";
    return c.json(await restaurantsServiceFor(c.env.DB).checkSlugAvailability(slug));
  })

  .post("/", async (c) => {
    const body = await parseJsonBody(c, createRestaurantSchema);
    if ("response" in body) return body.response;
    const restaurant = await restaurantsServiceFor(c.env.DB).create(c.get("userId"), body.data);
    return c.json(restaurant, 201);
  })

  .put("/me/logo", uploadBodyLimit("logo", LOGO_MAX_BYTES), async (c) => {
    const upload = await readUploadedFile(c, "logo");
    if ("response" in upload) return upload.response;

    const result = await logoServiceFor(c.env.DB, c.env.MEDIA).uploadLogo(c.get("userId"), {
      bytes: await upload.file.arrayBuffer(),
      contentType: upload.file.type,
    });
    return c.json(result);
  })

  .delete("/me/logo", async (c) => {
    await logoServiceFor(c.env.DB, c.env.MEDIA).removeLogo(c.get("userId"));
    return c.body(null, 204);
  })

  .onError(domainErrorHandler("restaurants"));
