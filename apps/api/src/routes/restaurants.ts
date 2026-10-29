import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createRestaurantSchema, type ApiErrorBody } from "@menucito/shared";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/require-session";
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
  return 400;
}

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

  .onError((error, c) => {
    if (error instanceof DomainError) return errorResponse(c, statusFor(error), error.code, error.message);
    console.error("[restaurants] unexpected error", error);
    return errorResponse(c, 500, "INTERNAL_ERROR", "Unexpected error");
  });
