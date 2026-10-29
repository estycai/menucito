import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import type { AppEnv } from "../env";

/**
 * Resolves the Better Auth session from the request cookies and exposes the user id as `userId`.
 * Answers 401 when there is no valid session. The tenant always comes from here, never from the body.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  c.set("userId", session.user.id);
  await next();
});
