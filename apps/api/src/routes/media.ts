import { Hono } from "hono";
import type { ApiErrorBody } from "@menucito/shared";
import type { AppEnv } from "../env";
import { MediaNotFoundError, mediaServiceFor } from "../services/media";

/** Each upload gets a new random key, so a stored object never changes: cache it for a year. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Public, unauthenticated read of uploaded media (logos). */
export const mediaRoutes = new Hono<AppEnv>()
  .get("/*", async (c) => {
    const object = await mediaServiceFor(c.env.MEDIA).read(c.req.path);
    return c.body(object.body, 200, {
      "Content-Type": object.contentType,
      "Content-Length": String(object.size),
      "Cache-Control": IMMUTABLE_CACHE,
      "X-Content-Type-Options": "nosniff",
      ETag: object.etag,
    });
  })

  .onError((error, c) => {
    c.header("X-Content-Type-Options", "nosniff");
    if (error instanceof MediaNotFoundError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, 404);
    }
    console.error("[media] unexpected error", error);
    return c.json<ApiErrorBody>({ error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, 500);
  });
