import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type MyRestaurant, type PermissionKey } from "@menucito/shared";
import {
  Client,
  createVerifiedAccount,
  errorCode,
  ownerWithRestaurant,
  signedInClient,
  staffClient,
  unique,
} from "./helpers";
import { OWNER_ROUTES, type RouteExpectation } from "./route-permissions";

const call = (client: Client, route: RouteExpectation) =>
  client.request(route.url, { method: route.method, body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}" });

const errorBody = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string; permission?: string } }).error;

describe("owner keeps every route working (scenario 10)", () => {
  it("answers the read routes with 200 and creates content as before", async () => {
    const { client } = await ownerWithRestaurant();
    for (const path of [
      "/api/restaurants/me",
      "/api/restaurants/me/settings",
      "/api/restaurants/me/location",
      "/api/restaurants/me/delivery-zones",
      "/api/restaurants/me/hours",
      "/api/categories",
      "/api/orders",
    ]) {
      expect((await client.get(path)).status, path).toBe(200);
    }

    const created = await client.post("/api/categories", { name: "Hamburguesas" });
    expect(created.status).toBe(201);
    expect((await client.patch("/api/restaurants/me/settings", { acceptingOrders: false })).status).toBe(200);
    expect((await client.get("/api/orders/export")).status).toBe(200);
  });
});

describe("a permission per route (scenarios 11 and 12)", () => {
  it("lets a member with orders.view list orders but refuses to change their status, naming the permission", async () => {
    const { client } = await staffClient({ permissions: ["orders.view"] });
    expect((await client.get("/api/orders")).status).toBe(200);

    const res = await client.patch("/api/orders/some-id/status", { status: "confirmed" });
    expect(res.status).toBe(403);
    expect(await errorBody(res)).toMatchObject({ code: "FORBIDDEN", permission: "orders.status" });
  });

  it("lets a member with menu.view read the menu and refuses every write", async () => {
    const owner = await ownerWithRestaurant();
    const category = (await (await owner.client.post("/api/categories", { name: "Postres" })).json()) as { id: string };
    const product = (await (
      await owner.client.post("/api/products", { categoryId: category.id, name: "Flan", priceCents: 100 })
    ).json()) as { id: string };
    const { client } = await staffClient({ owner, permissions: ["menu.view"] });

    expect((await client.get("/api/categories")).status).toBe(200);
    expect((await client.get(`/api/products/${product.id}`)).status).toBe(200);

    const writes: [string, string, string?][] = [
      ["POST", "/api/categories", "{}"],
      ["PUT", "/api/categories/order", "{}"],
      ["PATCH", `/api/categories/${category.id}`, "{}"],
      ["DELETE", `/api/categories/${category.id}`],
      ["PUT", `/api/categories/${category.id}/featured`, "{}"],
      ["PUT", `/api/categories/${category.id}/products/order`, "{}"],
      ["POST", "/api/products", "{}"],
      ["PATCH", `/api/products/${product.id}`, "{}"],
      ["DELETE", `/api/products/${product.id}`],
      ["PUT", `/api/products/${product.id}/ingredients`, "{}"],
      ["PUT", `/api/products/${product.id}/photo`, "{}"],
      ["DELETE", `/api/products/${product.id}/photo`],
    ];
    for (const [method, path, body] of writes) {
      const res = await client.request(path, { method, body });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorBody(res)).permission).toBe("menu.edit");
    }
    // Nothing was written.
    expect((await owner.client.get(`/api/products/${product.id}`)).status).toBe(200);
  });

  const permissionRoutes = OWNER_ROUTES.filter((route): route is RouteExpectation & { declared: PermissionKey } =>
    (ALL_PERMISSIONS as readonly string[]).includes(route.declared),
  );

  it("refuses with FORBIDDEN, naming the key, a member that has no permissions at all, on every permission route", async () => {
    const { client } = await staffClient({ permissions: [] });
    for (const route of permissionRoutes) {
      const res = await call(client, route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(403);
      expect(await errorBody(res), `${route.method} ${route.pattern}`).toMatchObject({ code: "FORBIDDEN", permission: route.declared });
    }
  });

  it("lets through, to the handler, a member holding exactly the declared key (and its section)", async () => {
    const owner = await ownerWithRestaurant();
    const byKey = new Map<PermissionKey, RouteExpectation[]>();
    for (const route of permissionRoutes) byKey.set(route.declared, [...(byKey.get(route.declared) ?? []), route]);

    for (const [key, routes] of byKey) {
      const section = `${key.split(".")[0]}.view` as PermissionKey;
      const { client } = await staffClient({ owner, permissions: key === section ? [key] : [section, key] });
      for (const route of routes) {
        const res = await call(client, route);
        // Reports is Pro-only: a Free local answers 403 PLAN_FEATURE after the guard lets it through.
        if (route.pattern.startsWith("/api/reports/") && res.status === 403) {
          expect(await errorCode(res), `${route.method} ${route.pattern}`).toBe("PLAN_FEATURE");
        } else {
          expect(res.status, `${route.method} ${route.pattern} with ${key}`).not.toBe(403);
        }
      }
    }
  });

  it("keeps owner-only routes closed to a member with every permission (OWNER_ONLY)", async () => {
    const { client } = await staffClient({ permissions: [...ALL_PERMISSIONS] });
    for (const route of OWNER_ROUTES.filter((r) => r.declared === "owner")) {
      const res = await call(client, route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(403);
      expect(await errorCode(res), `${route.method} ${route.pattern}`).toBe("OWNER_ONLY");
    }
  });
});

describe("inactive members and roles (scenario 14)", () => {
  it("answers MEMBER_INACTIVE on every route of the owner to a deactivated member that still has a session", async () => {
    const { client } = await staffClient({ permissions: [...ALL_PERMISSIONS], active: false });
    expect(client.hasSession).toBe(true);
    for (const route of OWNER_ROUTES.filter((r) => r.declared !== "member")) {
      const res = await call(client, route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(403);
      expect(await errorCode(res), `${route.method} ${route.pattern}`).toBe("MEMBER_INACTIVE");
    }
  });

  it("still lets a deactivated member read GET /api/restaurants/me, so the admin can tell it apart", async () => {
    const { client } = await staffClient({ permissions: ["menu.view"], active: false });
    const res = await client.get("/api/restaurants/me");
    expect(res.status).toBe(200);
    expect(((await res.json()) as MyRestaurant).access).toMatchObject({ active: false, permissions: [] });
  });

  it("answers FORBIDDEN on every route but /me when the role is inactive", async () => {
    const { client } = await staffClient({ permissions: [...ALL_PERMISSIONS], roleActive: false });
    for (const route of OWNER_ROUTES.filter((r) => r.declared !== "member" && r.declared !== "owner" && r.declared !== "courier")) {
      const res = await call(client, route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(403);
      expect(await errorCode(res), `${route.method} ${route.pattern}`).toBe("FORBIDDEN");
    }
    const me = await client.get("/api/restaurants/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as MyRestaurant).access).toMatchObject({ active: true, role: { active: false }, permissions: [] });
  });
});

describe("a user without a restaurant (scenario 15)", () => {
  it("gets 404 RESTAURANT_NOT_FOUND on the owner's routes, as before, and can still do the onboarding", async () => {
    const account = await createVerifiedAccount("Sin Local");
    const client = await signedInClient(account.email);

    for (const route of OWNER_ROUTES.filter((r) => !r.pattern.startsWith("/api/members") && !r.pattern.startsWith("/api/roles"))) {
      const res = await call(client, route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(404);
      expect(await errorCode(res)).toBe("RESTAURANT_NOT_FOUND");
    }

    expect((await client.get(`/api/restaurants/slug-available?slug=nuevo-${unique()}`)).status).toBe(200);
    const created = await client.post("/api/restaurants", {
      name: "Nuevo",
      slug: `nuevo-${unique()}`,
      whatsapp: "11 1234-5678",
      delivery: true,
      takeaway: false,
    });
    expect(created.status).toBe(201);
    expect((await client.get("/api/restaurants/me")).status).toBe(200);
  });

  it("answers 401 without a session on the new routes too", async () => {
    for (const route of OWNER_ROUTES) {
      const res = await call(new Client(), route);
      expect(res.status, `${route.method} ${route.pattern}`).toBe(401);
    }
  });
});

describe("GET /api/restaurants/me (scenario 16)", () => {
  it("adds the access of the owner: the system role and every key of the catalog", async () => {
    const owner = await ownerWithRestaurant();
    const body = (await (await owner.client.get("/api/restaurants/me")).json()) as MyRestaurant;
    expect(body).toMatchObject({ id: owner.restaurantId, slug: owner.slug, name: "Lo de Marta", plan: "basic" });
    expect(body.access).toEqual({
      memberId: owner.memberId,
      isOwner: true,
      isCourier: false,
      active: true,
      role: { id: expect.any(String), name: "Dueño", active: true },
      permissions: [...ALL_PERMISSIONS],
    });
  });

  it("adds the access of a member with its normalized permissions, ignoring keys that left the catalog", async () => {
    const staff = await staffClient({ permissions: ["orders.payment", "orders.view"] });
    await env.DB.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'ghost.view')").bind(staff.roleId).run();

    const body = (await (await staff.client.get("/api/restaurants/me")).json()) as MyRestaurant;
    expect(body.id).toBe(staff.owner.restaurantId);
    expect(body.access).toEqual({
      memberId: staff.memberId,
      isOwner: false,
      isCourier: false,
      active: true,
      role: { id: staff.roleId, name: expect.stringMatching(/^Rol /), active: true },
      permissions: ["orders.view", "orders.payment"],
    });
  });

  it("shows a member the changes of its role on the next request, without signing in again", async () => {
    const staff = await staffClient({ permissions: ["orders.view"] });
    expect((await staff.client.get("/api/categories")).status).toBe(403);
    await staff.owner.client.patch(`/api/roles/${staff.roleId}`, { permissions: ["orders.view", "menu.view"] });
    expect((await staff.client.get("/api/categories")).status).toBe(200);
  });
});

describe("a member cannot open a restaurant (scenario 17)", () => {
  it("answers 409 ALREADY_HAS_RESTAURANT to a staff member", async () => {
    const { client } = await staffClient({ permissions: ["orders.view"] });
    const res = await client.post("/api/restaurants", {
      name: "Otro",
      slug: `otro-${unique()}`,
      whatsapp: "11 1234-5678",
      delivery: true,
      takeaway: true,
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("ALREADY_HAS_RESTAURANT");
  });
});

describe("tenancy", () => {
  it("scopes a member to the restaurant of its owner, never to another one", async () => {
    const a = await ownerWithRestaurant();
    const b = await ownerWithRestaurant();
    await b.client.post("/api/categories", { name: "Solo de B" });
    const staff = await staffClient({ owner: a, permissions: ["menu.view"] });
    const catalog = (await (await staff.client.get("/api/categories")).json()) as { categories: unknown[] };
    expect(catalog.categories).toHaveLength(0);
  });
});

describe("public endpoints (scenario 18)", () => {
  it("still answer without a session", async () => {
    const owner = await ownerWithRestaurant();
    const menu = await new Client().get(`/api/public/menus/${owner.slug}`);
    expect(menu.status).toBe(200);
    expect((await new Client().get("/api/public/menus/no-such-store")).status).toBe(404);
  });
});
