import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { ALL_PERMISSIONS, hasPermission, normalizePermissions, type ApiErrorBody, type PermissionKey } from "@menucito/shared";
import type { AppEnv } from "../env";
import { createMembersRepository } from "../repositories/members";

/**
 * What a route declares about who may call it. Every route of the owner's API carries exactly one of
 * these (`test/route-guards.test.ts` walks the registered routes and fails when one does not).
 */
export type RouteGuard =
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "owner" }
  /** Any member, with no permission needed (`GET /api/restaurants/me`: the admin needs it to know what the user can do). */
  | { kind: "member" };

type GuardedMiddleware = MiddlewareHandler<AppEnv> & { guard: RouteGuard };

/** Reads the guard a route middleware was declared with; `undefined` for any other handler. */
export function guardOf(handler: unknown): RouteGuard | undefined {
  return typeof handler === "function" ? (handler as Partial<GuardedMiddleware>).guard : undefined;
}

const forbidden = (c: Parameters<MiddlewareHandler<AppEnv>>[0], code: string, message: string, permission?: PermissionKey) =>
  c.json<ApiErrorBody>({ error: { code, message, ...(permission ? { permission } : {}) } }, 403);

/**
 * Loads the member behind the session (after `requireSession`): its restaurant and effective
 * permissions go to `c.var.member`. A user with no membership has no restaurant yet (404
 * `RESTAURANT_NOT_FOUND`, as before this existed). It does not check permissions: `requirePermission`,
 * `requireOwner` and `allowAnyMember` do, per route. An inactive member still gets through here so
 * `GET /api/restaurants/me` can tell the admin; every guard below refuses it.
 */
export const requireMember = createMiddleware<AppEnv>(async (c, next) => {
  const access = await createMembersRepository(c.env.DB).findAccessByUserId(c.get("userId"));
  if (!access) {
    return c.json<ApiErrorBody>({ error: { code: "RESTAURANT_NOT_FOUND", message: "Todavía no tenés un local" } }, 404);
  }
  const { member, role } = access;
  const permissions = member.isOwner ? [...ALL_PERMISSIONS] : role.active ? normalizePermissions(access.permissions) : [];
  c.set("member", {
    memberId: member.id,
    userId: member.userId,
    restaurantId: member.restaurantId,
    isOwner: member.isOwner,
    active: member.active,
    permissions,
    role: { id: role.id, name: role.name, active: role.active },
  });
  await next();
});

function guarded(guard: RouteGuard, check: MiddlewareHandler<AppEnv>): GuardedMiddleware {
  return Object.assign(createMiddleware<AppEnv>(check), { guard });
}

const INACTIVE_MESSAGE = "Tu usuario está desactivado. Hablá con el dueño del local.";

/** 403 `MEMBER_INACTIVE` for a deactivated member, 403 `FORBIDDEN` (with the key) when the permission is missing. */
export function requirePermission(permission: PermissionKey): GuardedMiddleware {
  return guarded({ kind: "permission", permission }, async (c, next) => {
    const member = c.get("member");
    if (!member.active) return forbidden(c, "MEMBER_INACTIVE", INACTIVE_MESSAGE);
    if (!hasPermission(member, permission)) {
      return forbidden(c, "FORBIDDEN", "No tenés permiso para hacer esto", permission);
    }
    await next();
  });
}

/** Owner-only routes (users, roles, plan): not a permission anyone can be given. */
export const requireOwner: GuardedMiddleware = guarded({ kind: "owner" }, async (c, next) => {
  const member = c.get("member");
  if (!member.active) return forbidden(c, "MEMBER_INACTIVE", INACTIVE_MESSAGE);
  if (!member.isOwner) return forbidden(c, "OWNER_ONLY", "Solo el dueño del local puede hacer esto");
  await next();
});

/** Declares that any member may call the route (even an inactive one or one with an inactive role). */
export const allowAnyMember: GuardedMiddleware = guarded({ kind: "member" }, async (_c, next) => {
  await next();
});
