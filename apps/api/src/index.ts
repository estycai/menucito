import { Hono } from "hono";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { restaurantsRoutes } from "./routes/restaurants";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    const ctx = c.executionCtx;
    waitUntil = (p) => ctx.waitUntil(p);
  } catch {
    // No execution context (e.g. unit tests): background tasks are awaited instead.
  }
  return createAuth(c.env, { waitUntil }).handler(c.req.raw);
});

app.route("/api/restaurants", restaurantsRoutes);

export default app;
