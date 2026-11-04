import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  ORDER_BODY_MAX_BYTES,
  createOrderRequestSchema,
  deliveryQuoteRequestSchema,
  placeDetailsQuerySchema,
  placeIdSchema,
  placeSearchQuerySchema,
  reverseGeocodeQuerySchema,
} from "@menucito/shared";
import type { AppEnv } from "../env";
import { publicDeliveryServiceFor } from "../services/delivery";
import { publicOrdersServiceFor } from "../services/orders";
import { publicPlacesServiceFor } from "../services/places";
import { publicMenuServiceFor } from "../services/public-menu";
import { placesRateLimiterFor } from "../services/rate-limit";
import { domainErrorHandler, errorResponse, orderBodyLimit, parseJsonBody, parseQuery } from "./http";

/** Public menus change when the owner edits them, so keep the cache short. */
const MENU_CACHE = "public, max-age=60";

/**
 * Per IP and menu limit of the address search: every call is billed by Google and nobody is logged
 * in. Cloudflare sets `cf-connecting-ip`; without it (local tools) all callers share one bucket.
 */
const placesRateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  await placesRateLimiterFor(c.env.DB).consume(`places:${c.req.param("slug")}:${ip}`);
  await next();
};

/** Unauthenticated endpoints for the diner-facing web app. No `requireSession` here. */
export const publicRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const rawOrigins = c.env.WEB_ORIGINS ?? "";
    const allowed = rawOrigins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowed.length === 0) {
      return next();
    }

    const handler = cors({
      origin: (origin) => (allowed.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    });
    return handler(c, next);
  })

  .get("/menus/:slug", async (c) => {
    const menu = await publicMenuServiceFor(c.env.DB).getBySlug(c.req.param("slug"));
    c.header("Cache-Control", MENU_CACHE);
    return c.json(menu);
  })

  .post("/menus/:slug/orders", orderBodyLimit(ORDER_BODY_MAX_BYTES), async (c) => {
    const contentType = c.req.header("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      return errorResponse(c, 422, "VALIDATION_ERROR", "El cuerpo debe ser JSON");
    }

    const body = await parseJsonBody(c, createOrderRequestSchema);
    if ("response" in body) return body.response;

    const result = await publicOrdersServiceFor(c.env.DB).createOrder(c.req.param("slug"), body.data);
    c.header("Cache-Control", "no-store");
    return c.json(result.response, result.status);
  })

  // Address search of the diner, only for stores in `zones` mode. `session` groups the calls of one
  // search for billing. `search` and `reverse` go before `:placeId`, which would match them too.
  .get("/menus/:slug/places/search", placesRateLimit, async (c) => {
    const query = parseQuery(c, placeSearchQuerySchema);
    if ("response" in query) return query.response;
    const places = publicPlacesServiceFor(c.env);
    c.header("Cache-Control", "no-store");
    return c.json(await places.search(c.req.param("slug"), query.data.q, query.data.session));
  })

  .get("/menus/:slug/places/reverse", placesRateLimit, async (c) => {
    const query = parseQuery(c, reverseGeocodeQuerySchema);
    if ("response" in query) return query.response;
    const places = publicPlacesServiceFor(c.env);
    c.header("Cache-Control", "no-store");
    return c.json(await places.reverse(c.req.param("slug"), query.data));
  })

  .get("/menus/:slug/places/:placeId", placesRateLimit, async (c) => {
    const placeId = placeIdSchema.safeParse(c.req.param("placeId"));
    if (!placeId.success) return errorResponse(c, 422, "VALIDATION_ERROR", `placeId: ${placeId.error.issues[0]?.message}`);
    const query = parseQuery(c, placeDetailsQuerySchema);
    if ("response" in query) return query.response;
    const places = publicPlacesServiceFor(c.env);
    c.header("Cache-Control", "no-store");
    return c.json(await places.details(c.req.param("slug"), placeId.data, query.data.session));
  })

  // Shipping of an address with the current subtotal. Pure math over the zones: no Google call.
  .post("/menus/:slug/delivery-quote", async (c) => {
    const body = await parseJsonBody(c, deliveryQuoteRequestSchema);
    if ("response" in body) return body.response;
    const quote = await publicDeliveryServiceFor(c.env.DB).quote(c.req.param("slug"), body.data);
    c.header("Cache-Control", "no-store");
    return c.json(quote);
  })

  .onError(domainErrorHandler("public"));
