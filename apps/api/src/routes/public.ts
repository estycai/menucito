import { Hono } from "hono";
import { cors } from "hono/cors";
import { ORDER_BODY_MAX_BYTES, createOrderRequestSchema } from "@menucito/shared";
import type { AppEnv } from "../env";
import { publicOrdersServiceFor } from "../services/orders";
import { publicMenuServiceFor } from "../services/public-menu";
import { domainErrorHandler, errorResponse, orderBodyLimit, parseJsonBody } from "./http";

/** Public menus change when the owner edits them, so keep the cache short. */
const MENU_CACHE = "public, max-age=60";

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

  .onError(domainErrorHandler("public"));
