import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Member, Role } from "@menucito/shared";
import { TEST_PASSWORD, errorCode, ownerWithRestaurant, signedInClient, staffClient, unique } from "./helpers";

const storedKeys = async (roleId: string) =>
  (await env.DB.prepare("SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission").bind(roleId).all<{ permission: string }>())
    .results.map((row) => row.permission);

const listRoles = async (client: { get(path: string): Promise<Response> }) => (await (await client.get("/api/roles")).json()) as Role[];

describe("GET /api/roles (scenario 31)", () => {
  it("lists the system role first, then the others by name, with member counts and permissions", async () => {
    const owner = await ownerWithRestaurant();
    await owner.client.post("/api/roles", { name: "zeta", permissions: ["stats.view"] });
    await owner.client.post("/api/roles", { name: "Cajero", permissions: ["orders.payment", "orders.view"] });
    const staff = await staffClient({ owner, permissions: ["menu.view"] });

    const res = await owner.client.get("/api/roles");
    expect(res.status).toBe(200);
    const roles = (await res.json()) as Role[];
    expect(roles.map((role) => role.name)).toEqual(["Dueño", "Cajero", expect.stringMatching(/^Rol /), "zeta"]);
    expect(roles[0]).toEqual({ id: expect.any(String), name: "Dueño", isSystem: true, active: true, memberCount: 1, permissions: [] });
    expect(roles[1]).toEqual({
      id: expect.any(String),
      name: "Cajero",
      isSystem: false,
      active: true,
      memberCount: 0,
      permissions: ["orders.view", "orders.payment"],
    });
    expect(roles.find((role) => role.id === staff.roleId)).toMatchObject({ memberCount: 1, permissions: ["menu.view"] });
  });

  it("never lists the roles of another local", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    await other.client.post("/api/roles", { name: "Solo de otro", permissions: [] });
    expect((await listRoles(owner.client)).map((role) => role.name)).toEqual(["Dueño"]);
  });
});

describe("POST /api/roles (scenario 32)", () => {
  it("creates an active role with its permissions", async () => {
    const owner = await ownerWithRestaurant();
    const res = await owner.client.post("/api/roles", { name: "Cajero", permissions: ["orders.view", "orders.payment"] });
    expect(res.status).toBe(201);
    const role = (await res.json()) as Role;
    expect(role).toEqual({
      id: expect.any(String),
      name: "Cajero",
      isSystem: false,
      active: true,
      memberCount: 0,
      permissions: ["orders.view", "orders.payment"],
    });
    expect(await storedKeys(role.id)).toEqual(["orders.payment", "orders.view"]);
  });

  it("answers 422 naming the missing section key when a sub-permission comes alone, and stores nothing", async () => {
    const owner = await ownerWithRestaurant();
    const res = await owner.client.post("/api/roles", { name: "Cajero", permissions: ["menu.edit"] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("menu.view");
    expect(await listRoles(owner.client)).toHaveLength(1);
  });

  it("drops unknown keys and repeated ones", async () => {
    const owner = await ownerWithRestaurant();
    const res = await owner.client.post("/api/roles", { name: "Mozo", permissions: ["ghost.view", "orders.view", "orders.view", "users.manage"] });
    expect(res.status).toBe(201);
    const role = (await res.json()) as Role;
    expect(role.permissions).toEqual(["orders.view"]);
    expect(await storedKeys(role.id)).toEqual(["orders.view"]);
  });

  it("creates a role with no permissions", async () => {
    const owner = await ownerWithRestaurant();
    const res = await owner.client.post("/api/roles", { name: "Sin acceso", permissions: [] });
    expect(res.status).toBe(201);
  });

  it.each([[""], ["   "], ["x".repeat(41)], ["Dueño"], ["DUEÑO"]])("answers 422 for the name %j", async (name) => {
    const owner = await ownerWithRestaurant();
    expect((await owner.client.post("/api/roles", { name, permissions: [] })).status).toBe(422);
  });
});

describe("PATCH /api/roles/:id (scenario 33)", () => {
  it("replaces the name and the permissions", async () => {
    const owner = await ownerWithRestaurant();
    const role = (await (await owner.client.post("/api/roles", { name: "Cajero", permissions: ["orders.view", "orders.payment"] })).json()) as Role;

    const res = await owner.client.patch(`/api/roles/${role.id}`, { name: "Encargado", permissions: ["menu.view", "menu.edit"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: role.id, name: "Encargado", permissions: ["menu.view", "menu.edit"], active: true });
    expect(await storedKeys(role.id)).toEqual(["menu.edit", "menu.view"]);
  });

  it("clears the permissions with an empty list and keeps them when the list is not sent", async () => {
    const owner = await ownerWithRestaurant();
    const role = (await (await owner.client.post("/api/roles", { name: "Cajero", permissions: ["orders.view"] })).json()) as Role;
    await owner.client.patch(`/api/roles/${role.id}`, { name: "Cajera" });
    expect(await storedKeys(role.id)).toEqual(["orders.view"]);
    await owner.client.patch(`/api/roles/${role.id}`, { permissions: [] });
    expect(await storedKeys(role.id)).toEqual([]);
  });

  it("is atomic: a name clash leaves the old permissions in place", async () => {
    const owner = await ownerWithRestaurant();
    await owner.client.post("/api/roles", { name: "Cajero", permissions: [] });
    const role = (await (await owner.client.post("/api/roles", { name: "Mozo", permissions: ["orders.view"] })).json()) as Role;

    const res = await owner.client.patch(`/api/roles/${role.id}`, { name: "cajero", permissions: ["menu.view"] });
    expect(res.status).toBe(409);
    expect(await storedKeys(role.id)).toEqual(["orders.view"]);
    expect((await listRoles(owner.client)).find((r) => r.id === role.id)).toMatchObject({ name: "Mozo" });
  });

  it("applies to its members on their next request, without signing in again", async () => {
    const staff = await staffClient({ permissions: ["orders.view"] });
    expect((await staff.client.get("/api/categories")).status).toBe(403);
    await staff.owner.client.patch(`/api/roles/${staff.roleId}`, { permissions: ["orders.view", "menu.view"] });
    expect((await staff.client.get("/api/categories")).status).toBe(200);
    await staff.owner.client.patch(`/api/roles/${staff.roleId}`, { permissions: [] });
    expect((await staff.client.get("/api/orders")).status).toBe(403);
  });

  it("answers 422 for an empty body, a bad name or a sub-permission alone", async () => {
    const owner = await ownerWithRestaurant();
    const role = (await (await owner.client.post("/api/roles", { name: "Cajero", permissions: [] })).json()) as Role;
    for (const body of [{}, { name: "" }, { name: "Dueño" }, { permissions: ["orders.status"] }]) {
      expect((await owner.client.patch(`/api/roles/${role.id}`, body)).status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe("deactivating a role (scenario 34)", () => {
  it("makes its members receive 403 FORBIDDEN and stops offering the role to assign", async () => {
    const staff = await staffClient({ permissions: ["orders.view"] });
    expect((await staff.client.get("/api/orders")).status).toBe(200);

    const off = await staff.owner.client.patch(`/api/roles/${staff.roleId}`, { active: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Role).active).toBe(false);

    const blocked = await staff.client.get("/api/orders");
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe("FORBIDDEN");

    const assign = await staff.owner.client.post("/api/members", {
      firstName: "Nuevo",
      lastName: "Usuario",
      email: `nuevo${unique()}@example.com`,
      password: TEST_PASSWORD,
      roleId: staff.roleId,
    });
    expect(assign.status).toBe(422);
    // The role still shows in the list, as inactive, with its member.
    expect((await listRoles(staff.owner.client)).find((role) => role.id === staff.roleId)).toMatchObject({ active: false, memberCount: 1 });

    await staff.owner.client.patch(`/api/roles/${staff.roleId}`, { active: true });
    expect((await staff.client.get("/api/orders")).status).toBe(200);
  });
});

describe("DELETE /api/roles/:id (scenario 35)", () => {
  it("deletes a role without members with 204, permissions included", async () => {
    const owner = await ownerWithRestaurant();
    const role = (await (await owner.client.post("/api/roles", { name: "Cajero", permissions: ["orders.view"] })).json()) as Role;
    const res = await owner.client.delete(`/api/roles/${role.id}`);
    expect(res.status).toBe(204);
    expect((await listRoles(owner.client)).map((r) => r.id)).not.toContain(role.id);
    expect(await storedKeys(role.id)).toEqual([]);
  });

  it("answers 409 ROLE_IN_USE with the number of members, and deletes nothing", async () => {
    const staff = await staffClient({ permissions: ["orders.view"] });
    const res = await staff.owner.client.delete(`/api/roles/${staff.roleId}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "ROLE_IN_USE", message: expect.stringContaining("1 usuario"), memberCount: 1 },
    });
    expect((await listRoles(staff.owner.client)).map((r) => r.id)).toContain(staff.roleId);

    // After moving the member to another role, the delete goes through.
    const other = (await (await staff.owner.client.post("/api/roles", { name: `Otro ${unique()}`, permissions: [] })).json()) as Role;
    await staff.owner.client.patch(`/api/members/${staff.memberId}`, { roleId: other.id });
    expect((await staff.owner.client.delete(`/api/roles/${staff.roleId}`)).status).toBe(204);
  });
});

describe("the system role (scenario 36)", () => {
  it("answers 409 SYSTEM_ROLE to editing, deactivating and deleting the owner's role", async () => {
    const owner = await ownerWithRestaurant();
    const system = (await listRoles(owner.client)).find((role) => role.isSystem)!;
    const attempts = [
      owner.client.patch(`/api/roles/${system.id}`, { name: "Jefe" }),
      owner.client.patch(`/api/roles/${system.id}`, { permissions: ["orders.view"] }),
      owner.client.patch(`/api/roles/${system.id}`, { active: false }),
      owner.client.delete(`/api/roles/${system.id}`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("SYSTEM_ROLE");
    }
    expect(await listRoles(owner.client)).toEqual([system]);
    const again = await signedInClient(owner.email, owner.password);
    expect((await again.get("/api/orders")).status).toBe(200);
  });

  it("never lets another role take the system name, so there is one 'Dueño' per local", async () => {
    const owner = await ownerWithRestaurant();
    expect((await owner.client.post("/api/roles", { name: "dueño", permissions: [] })).status).toBe(422);
    expect((await owner.client.post("/api/roles", { name: "Dueño", permissions: [] })).status).toBe(422);
  });
});

describe("role names (scenario 37)", () => {
  it("answers 409 ROLE_NAME_TAKEN for a second role with the same name, ignoring case", async () => {
    const owner = await ownerWithRestaurant();
    expect((await owner.client.post("/api/roles", { name: "Cajero", permissions: [] })).status).toBe(201);
    for (const name of ["Cajero", "cajero", " CAJERO "]) {
      const res = await owner.client.post("/api/roles", { name, permissions: [] });
      expect(res.status, name).toBe(409);
      expect(await errorCode(res)).toBe("ROLE_NAME_TAKEN");
    }
    expect((await listRoles(owner.client)).filter((role) => role.name.toLowerCase() === "cajero")).toHaveLength(1);
  });

  it("allows the same name in another local", async () => {
    const a = await ownerWithRestaurant();
    const b = await ownerWithRestaurant();
    expect((await a.client.post("/api/roles", { name: "Cajero", permissions: [] })).status).toBe(201);
    expect((await b.client.post("/api/roles", { name: "Cajero", permissions: [] })).status).toBe(201);
  });
});

describe("roles of other restaurants (scenario 38)", () => {
  it("answers 404 for a role of another local or an unknown one, changing nothing", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const foreign = (await (await other.client.post("/api/roles", { name: "Ajeno", permissions: ["orders.view"] })).json()) as Role;

    for (const id of [foreign.id, "no-such-role"]) {
      for (const res of [
        await owner.client.patch(`/api/roles/${id}`, { name: "Hack" }),
        await owner.client.patch(`/api/roles/${id}`, { active: false }),
        await owner.client.delete(`/api/roles/${id}`),
      ]) {
        expect(res.status, id).toBe(404);
        expect(await errorCode(res)).toBe("ROLE_NOT_FOUND");
      }
    }
    expect((await listRoles(other.client)).find((role) => role.id === foreign.id)).toMatchObject({ name: "Ajeno", active: true });
    expect(await storedKeys(foreign.id)).toEqual(["orders.view"]);
  });

  it("does not let a member of one local be given a role of another through the members API", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const foreign = (await (await other.client.post("/api/roles", { name: "Ajeno", permissions: [] })).json()) as Role;
    const mine = (await (await owner.client.post("/api/roles", { name: "Propio", permissions: [] })).json()) as Role;
    const created = (await (
      await owner.client.post("/api/members", {
        firstName: "Ana",
        lastName: "Pérez",
        email: `ana${unique()}@example.com`,
        password: TEST_PASSWORD,
        roleId: mine.id,
      })
    ).json()) as Member;
    expect((await owner.client.patch(`/api/members/${created.id}`, { roleId: foreign.id })).status).toBe(422);
  });
});
