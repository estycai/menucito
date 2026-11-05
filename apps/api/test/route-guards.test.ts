import { describe, expect, it } from "vitest";
import app from "../src/index";
import { guardOf, type RouteGuard } from "../src/middleware/require-member";
import { NON_OWNER_PREFIXES, OWNER_ROUTES, SESSION_ONLY_ROUTES, type Declared } from "./route-permissions";

/** `app.route()` wraps each sub-router handler (to apply its `onError`); the original is kept under this key. */
const COMPOSED_HANDLER = "__COMPOSED_HANDLER";
const unwrap = (handler: unknown): unknown => (handler as Record<string, unknown>)[COMPOSED_HANDLER] ?? handler;
const guardOfRoute = (handler: unknown) => guardOf(unwrap(handler));

const describeGuard = (guard: RouteGuard): Declared => (guard.kind === "permission" ? guard.permission : guard.kind);

/** `app.routes` lists every handler of every route (and `use` middleware as method ALL); group them per method and path. */
function registeredRoutes() {
  const byRoute = new Map<string, unknown[]>();
  for (const { method, path, handler } of app.routes) {
    if (method === "ALL") continue;
    const key = `${method} ${path}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), handler]);
  }
  return byRoute;
}

describe("every route of the owner's API declares its permission (scenario 13)", () => {
  const routes = registeredRoutes();
  const ownerRoutes = [...routes].filter(([key]) => {
    const path = key.slice(key.indexOf(" ") + 1);
    return !NON_OWNER_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) && !SESSION_ONLY_ROUTES.includes(key);
  });

  it("finds the routes (the walk is not vacuous)", () => {
    expect(ownerRoutes.length).toBeGreaterThanOrEqual(OWNER_ROUTES.length);
  });

  it.each(ownerRoutes)("%s declares exactly one guard", (_key, handlers) => {
    const guards = handlers.map(guardOfRoute).filter((guard): guard is RouteGuard => guard !== undefined);
    expect(guards).toHaveLength(1);
  });

  it("declares what the permission table of decision 2 says, no more and no fewer routes", () => {
    const declared = Object.fromEntries(
      ownerRoutes.map(([key, handlers]) => [key, describeGuard(handlers.map(guardOfRoute).find((g) => g !== undefined)!)]),
    );
    const expected = Object.fromEntries(OWNER_ROUTES.map((r) => [`${r.method} ${r.pattern}`, r.declared]));
    expect(declared).toEqual(expected);
  });

  it("keeps onboarding and the public API free of member guards", () => {
    for (const key of SESSION_ONLY_ROUTES) {
      expect(routes.has(key)).toBe(true);
      expect(routes.get(key)!.some((handler) => guardOfRoute(handler))).toBe(false);
    }
    for (const [key, handlers] of routes) {
      const path = key.slice(key.indexOf(" ") + 1);
      if (path.startsWith("/api/public/")) expect(handlers.some((handler) => guardOfRoute(handler))).toBe(false);
    }
  });
});
