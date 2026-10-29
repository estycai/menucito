import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { LOGO_MAX_BYTES, createRestaurantSchema, type ApiErrorBody } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
import { LogoTooLargeError, UnsupportedLogoTypeError, logoServiceFor } from "../services/logos";
import {
  AlreadyHasRestaurantError,
  DomainError,
  InvalidRestaurantError,
  RestaurantNotFoundError,
  SlugTakenError,
  restaurantsServiceFor,
} from "../services/restaurants";

function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, code: string, message: string) {
  return c.json<ApiErrorBody>({ error: { code, message } }, status);
}

function statusFor(error: DomainError): ContentfulStatusCode {
  if (error instanceof RestaurantNotFoundError) return 404;
  if (error instanceof SlugTakenError || error instanceof AlreadyHasRestaurantError) return 409;
  if (error instanceof InvalidRestaurantError) return 422;
  if (error instanceof LogoTooLargeError) return 413;
  if (error instanceof UnsupportedLogoTypeError) return 415;
  return 400;
}

/** Room for the multipart envelope; the exact file size limit is a service rule. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

/** Rejects oversized bodies before reading them into memory. */
const logoBodyLimit = bodyLimit({
  maxSize: LOGO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) => {
    const error = new LogoTooLargeError();
    return errorResponse(c, 413, error.code, error.message);
  },
});

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
    const body: unknown = await c.req.json().catch(() => undefined);
    const parsed = createRestaurantSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input";
      return errorResponse(c, 422, "VALIDATION_ERROR", message);
    }
    const restaurant = await restaurantsServiceFor(c.env.DB).create(c.get("userId"), parsed.data);
    return c.json(restaurant, 201);
  })

  .put("/me/logo", logoBodyLimit, async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return errorResponse(c, 415, "UNSUPPORTED_MEDIA_TYPE", "Send the logo as multipart/form-data");
    }
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return errorResponse(c, 422, "VALIDATION_ERROR", "file: a file is required");

    const result = await logoServiceFor(c.env.DB, c.env.MEDIA).uploadLogo(c.get("userId"), {
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    });
    return c.json(result);
  })

  .delete("/me/logo", async (c) => {
    await logoServiceFor(c.env.DB, c.env.MEDIA).removeLogo(c.get("userId"));
    return c.body(null, 204);
  })

  .onError((error, c) => {
    if (error instanceof DomainError) return errorResponse(c, statusFor(error), error.code, error.message);
    console.error("[restaurants] unexpected error", error);
    return errorResponse(c, 500, "INTERNAL_ERROR", "Unexpected error");
  });
