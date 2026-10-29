import { Hono } from "hono";
import type { AppEnv } from "../env";
import { publicMenuServiceFor } from "../services/public-menu";
import { domainErrorHandler } from "./http";

/** Public menus change when the owner edits them, so keep the cache short. */
const MENU_CACHE = "public, max-age=60";

/** Unauthenticated, read-only endpoints for the diner-facing web app. No `requireSession` here. */
export const publicRoutes = new Hono<AppEnv>()
  .get("/menus/:slug", async (c) => {
    const menu = await publicMenuServiceFor(c.env.DB).getBySlug(c.req.param("slug"));
    c.header("Cache-Control", MENU_CACHE);
    return c.json(menu);
  })

  .onError(domainErrorHandler("public"));
