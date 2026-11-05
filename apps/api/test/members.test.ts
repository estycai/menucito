import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type Member, type MemberList, type Role } from "@menucito/shared";
import { createAuthAdmin } from "../src/auth-admin";
import type { Env } from "../src/env";
import { createMembersRepository } from "../src/repositories/members";
import { createRolesRepository } from "../src/repositories/roles";
import { createMembersService } from "../src/services/members";
import {
  Client,
  TEST_PASSWORD,
  captureEmails,
  createVerifiedAccount,
  errorCode,
  ownerWithRestaurant,
  signedInClient,
  staffClient,
  unique,
  type OwnerFixture,
} from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

const count = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())!.n;

async function createRole(owner: OwnerFixture, permissions: string[] = ["orders.view"]): Promise<Role> {
  const res = await owner.client.post("/api/roles", { name: `Rol ${unique()}`, permissions });
  expect(res.status).toBe(201);
  return (await res.json()) as Role;
}

const memberBody = (roleId: string, overrides: Record<string, unknown> = {}) => ({
  firstName: "Ana",
  lastName: "Pérez",
  email: `ana${unique()}@example.com`,
  password: TEST_PASSWORD,
  roleId,
  ...overrides,
});

async function createMember(owner: OwnerFixture, roleId: string, overrides: Record<string, unknown> = {}) {
  const body = memberBody(roleId, overrides);
  const res = await owner.client.post("/api/members", body);
  expect(res.status).toBe(201);
  return { member: (await res.json()) as Member, email: body.email as string };
}

describe("POST /api/members (scenario 19)", () => {
  it("creates the member and an account that signs in on the first attempt, without sending any email", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const body = memberBody(role.id, { email: `  Nueva${unique()}@Example.com `, phonePrefix: "+54", phone: "11 1234 5678", isCourier: true });
    sink.emails.length = 0;

    const res = await owner.client.post("/api/members", body);
    expect(res.status).toBe(201);
    const member = (await res.json()) as Member & { password?: string };
    const email = body.email.trim().toLowerCase();
    expect(member).toEqual({
      id: expect.any(String),
      firstName: "Ana",
      lastName: "Pérez",
      email,
      phone: "+5491112345678",
      role: { id: role.id, name: role.name, active: true },
      isCourier: true,
      isOwner: false,
      active: true,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(member)).not.toContain(TEST_PASSWORD);
    expect(member.password).toBeUndefined();

    const user = await env.DB.prepare("SELECT id, name, email_verified FROM user WHERE email = ?").bind(email).first<{
      id: string;
      name: string;
      email_verified: number;
    }>();
    expect(user).toMatchObject({ name: "Ana Pérez", email_verified: 1 });
    expect(await count("SELECT count(*) AS n FROM account WHERE user_id = ? AND provider_id = 'credential'", user!.id)).toBe(1);

    const staff = new Client();
    const signIn = await staff.post("/api/auth/sign-in/email", { email, password: TEST_PASSWORD });
    expect(signIn.status).toBe(200);
    expect(staff.hasSession).toBe(true);
    const me = await staff.get("/api/restaurants/me");
    expect(me.status).toBe(200);
    expect(sink.emails).toHaveLength(0);
  });

  it("answers 422 for an invalid body and creates nothing", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const users = await count("SELECT count(*) AS n FROM user");
    for (const overrides of [{ password: "short" }, { email: "not-an-email" }, { firstName: "" }, { phone: "123", phonePrefix: "+54" }]) {
      const res = await owner.client.post("/api/members", memberBody(role.id, overrides));
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    }
    expect(await count("SELECT count(*) AS n FROM user")).toBe(users);
  });
});

describe("email already in use (scenario 20)", () => {
  it("answers 409 EMAIL_IN_USE for the email of another local, an owner or someone who signed up alone, and creates nothing", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const lonely = await createVerifiedAccount("Solo Registrado");
    const role = await createRole(owner);
    const users = await count("SELECT count(*) AS n FROM user");
    const members = await count("SELECT count(*) AS n FROM restaurant_members");

    for (const email of [other.email, owner.email, lonely.email, lonely.email.toUpperCase()]) {
      const res = await owner.client.post("/api/members", memberBody(role.id, { email }));
      expect(res.status, email).toBe(409);
      expect(await errorCode(res)).toBe("EMAIL_IN_USE");
    }
    expect(await count("SELECT count(*) AS n FROM user")).toBe(users);
    expect(await count("SELECT count(*) AS n FROM restaurant_members")).toBe(members);
  });
});

describe("failure after the account is created (scenario 21)", () => {
  it("deletes the account again when the member insert fails, leaving no loose user", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const members = createMembersRepository(env.DB);
    const service = createMembersService({
      members: { ...members, insert: async () => Promise.reject(new Error("D1 down")) },
      roles: createRolesRepository(env.DB),
      authAdmin: await createAuthAdmin(env as unknown as Env),
    });
    const users = await count("SELECT count(*) AS n FROM user");
    const email = `compensate${unique()}@example.com`;

    await expect(
      service.create(owner.restaurantId, {
        firstName: "Ana",
        lastName: "Pérez",
        email,
        password: TEST_PASSWORD,
        roleId: role.id,
        isCourier: false,
        phone: null,
      }),
    ).rejects.toThrow("D1 down");

    expect(await count("SELECT count(*) AS n FROM user")).toBe(users);
    expect(await count("SELECT count(*) AS n FROM user WHERE email = ?", email)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM account WHERE account_id NOT IN (SELECT id FROM user)")).toBe(0);
  });
});

describe("assignable roles (scenario 22)", () => {
  it("answers 422 VALIDATION_ERROR for a role of another local, an inactive one, the system one or an unknown one", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const foreign = await createRole(other);
    const inactive = await createRole(owner);
    await owner.client.patch(`/api/roles/${inactive.id}`, { active: false });
    const system = ((await (await owner.client.get("/api/roles")).json()) as Role[]).find((role) => role.isSystem)!;
    const users = await count("SELECT count(*) AS n FROM user");

    for (const roleId of [foreign.id, inactive.id, system.id, "no-such-role"]) {
      const res = await owner.client.post("/api/members", memberBody(roleId));
      expect(res.status, roleId).toBe(422);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    }
    expect(await count("SELECT count(*) AS n FROM user")).toBe(users);
  });
});

describe("GET /api/members (scenario 23)", () => {
  it("lists the owner first and the rest by name, with the fields of the table", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    await createMember(owner, role.id, { firstName: "zoe", lastName: "A" });
    await createMember(owner, role.id, { firstName: "Bruno", lastName: "Z" });
    await createMember(owner, role.id, { firstName: "bruno", lastName: "A" });

    const res = await owner.client.get("/api/members?page=1&limit=20");
    expect(res.status).toBe(200);
    const list = (await res.json()) as MemberList;
    expect(list).toMatchObject({ page: 1, limit: 20, total: 4 });
    expect(list.members.map((m) => `${m.firstName} ${m.lastName}`)).toEqual(["Marta Gómez", "bruno A", "Bruno Z", "zoe A"]);
    expect(list.members[0]).toEqual({
      id: owner.memberId,
      firstName: "Marta",
      lastName: "Gómez",
      email: owner.email,
      phone: null,
      role: { id: expect.any(String), name: "Dueño", active: true },
      isCourier: false,
      isOwner: true,
      active: true,
      createdAt: expect.any(String),
    });
    expect(list.members[1]).toMatchObject({ isOwner: false, role: { id: role.id }, email: expect.stringContaining("@") });
  });

  it("paginates and filters by courier and active", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const courier = await createMember(owner, role.id, { firstName: "Carlos", isCourier: true });
    const idle = await createMember(owner, role.id, { firstName: "Dora" });
    await owner.client.patch(`/api/members/${idle.member.id}/active`, { active: false });

    const page2 = (await (await owner.client.get("/api/members?page=2&limit=2")).json()) as MemberList;
    expect(page2).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(page2.members.map((m) => m.firstName)).toEqual(["Dora"]);

    const couriers = (await (await owner.client.get("/api/members?courier=true")).json()) as MemberList;
    expect(couriers.members.map((m) => m.id)).toEqual([courier.member.id]);
    const active = (await (await owner.client.get("/api/members?active=true")).json()) as MemberList;
    expect(active.members.map((m) => m.firstName)).toEqual(["Marta", "Carlos"]);
    const both = (await (await owner.client.get("/api/members?active=true&courier=true")).json()) as MemberList;
    expect(both.members.map((m) => m.firstName)).toEqual(["Carlos"]);
    const inactive = (await (await owner.client.get("/api/members?active=false")).json()) as MemberList;
    expect(inactive.members.map((m) => m.firstName)).toEqual(["Dora"]);
  });

  it("never lists members of another local", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    await createMember(other, (await createRole(other)).id);
    expect(((await (await owner.client.get("/api/members")).json()) as MemberList).total).toBe(1);
  });

  it("answers 422 for a bad query", async () => {
    const owner = await ownerWithRestaurant();
    expect((await owner.client.get("/api/members?limit=1000")).status).toBe(422);
    expect((await owner.client.get("/api/members?courier=maybe")).status).toBe(422);
  });
});

describe("PATCH /api/members/:id (scenario 24)", () => {
  it("updates name, last name, phone, role and courier flag", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const next = await createRole(owner, ["menu.view"]);
    const { member, email } = await createMember(owner, role.id);

    const res = await owner.client.patch(`/api/members/${member.id}`, {
      firstName: "Ana María",
      lastName: "Gómez",
      phonePrefix: "+598",
      phone: "99 123 456",
      roleId: next.id,
      isCourier: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: member.id,
      firstName: "Ana María",
      lastName: "Gómez",
      email,
      phone: "+59899123456",
      role: { id: next.id },
      isCourier: true,
    });
    // The account name follows, and the member sees the new role right away.
    expect(await count("SELECT count(*) AS n FROM user WHERE email = ? AND name = 'Ana María Gómez'", email)).toBe(1);
    const staff = await signedInClient(email);
    expect((await staff.get("/api/categories")).status).toBe(200);
  });

  it("clears the phone with null and leaves it alone when it is not sent", async () => {
    const owner = await ownerWithRestaurant();
    const { member } = await createMember(owner, (await createRole(owner)).id, { phone: "11 1234 5678" });
    const untouched = await owner.client.patch(`/api/members/${member.id}`, { isCourier: true });
    expect(((await untouched.json()) as Member).phone).toBe("+5491112345678");
    const cleared = await owner.client.patch(`/api/members/${member.id}`, { phone: null });
    expect(((await cleared.json()) as Member).phone).toBeNull();
  });

  it("rejects an email or a password in the body with 422 and changes nothing", async () => {
    const owner = await ownerWithRestaurant();
    const { member, email } = await createMember(owner, (await createRole(owner)).id);
    for (const extra of [{ email: "other@example.com" }, { password: "another-password-1" }]) {
      const res = await owner.client.patch(`/api/members/${member.id}`, { firstName: "Otro", ...extra });
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
    }
    const list = (await (await owner.client.get("/api/members")).json()) as MemberList;
    expect(list.members.find((m) => m.id === member.id)).toMatchObject({ firstName: "Ana", email });
    expect((await signedInClient(email)).hasSession).toBe(true);
  });

  it("refuses a role that cannot be assigned with 422", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const { member } = await createMember(owner, (await createRole(owner)).id);
    const res = await owner.client.patch(`/api/members/${member.id}`, { roleId: (await createRole(other)).id });
    expect(res.status).toBe(422);
  });
});

describe("the owner's member (scenario 25)", () => {
  it("answers 409 OWNER_IMMUTABLE to a role change, deactivation, password change and deletion", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const id = owner.memberId;
    const attempts = [
      owner.client.patch(`/api/members/${id}`, { roleId: role.id }),
      owner.client.patch(`/api/members/${id}/active`, { active: false }),
      owner.client.put(`/api/members/${id}/password`, { password: "another-password-1" }),
      owner.client.delete(`/api/members/${id}`),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("OWNER_IMMUTABLE");
    }
    // Nothing changed: the owner still signs in with the same password and is still the owner.
    const again = await signedInClient(owner.email, owner.password);
    expect(((await (await again.get("/api/restaurants/me")).json()) as { access: { isOwner: boolean } }).access.isOwner).toBe(true);
  });

  it("lets the owner edit its own name, last name, phone and courier flag (and 'changing' to the same role)", async () => {
    const owner = await ownerWithRestaurant();
    const current = ((await (await owner.client.get("/api/members")).json()) as MemberList).members[0]!;
    const res = await owner.client.patch(`/api/members/${owner.memberId}`, {
      firstName: "Marta Inés",
      lastName: "Gómez",
      phone: "11 1234 5678",
      isCourier: true,
      roleId: current.role.id,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ firstName: "Marta Inés", phone: "+5491112345678", isCourier: true, isOwner: true });
  });
});

describe("PATCH /api/members/:id/active (scenario 26)", () => {
  it("deactivates, deleting the sessions, and reactivates without bringing them back", async () => {
    const owner = await ownerWithRestaurant();
    const { member, email } = await createMember(owner, (await createRole(owner)).id);
    const staff = await signedInClient(email);
    const other = await signedInClient(email);
    expect((await staff.get("/api/restaurants/me")).status).toBe(200);

    const off = await owner.client.patch(`/api/members/${member.id}/active`, { active: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Member).active).toBe(false);
    expect((await staff.get("/api/restaurants/me")).status).toBe(401);
    expect((await other.get("/api/restaurants/me")).status).toBe(401);

    // A fresh sign-in gets a session, but the owner's routes refuse the inactive member.
    const fresh = await signedInClient(email);
    const blocked = await fresh.get("/api/orders");
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe("MEMBER_INACTIVE");

    const on = await owner.client.patch(`/api/members/${member.id}/active`, { active: true });
    expect(((await on.json()) as Member).active).toBe(true);
    expect((await staff.get("/api/restaurants/me")).status).toBe(401);
    // The session opened while inactive works again now that the member is active (the role has orders.view).
    expect((await fresh.get("/api/orders")).status).toBe(200);
  });

  it("answers 422 without a boolean", async () => {
    const owner = await ownerWithRestaurant();
    const { member } = await createMember(owner, (await createRole(owner)).id);
    expect((await owner.client.patch(`/api/members/${member.id}/active`, { active: "no" })).status).toBe(422);
  });
});

describe("PUT /api/members/:id/password (scenario 27)", () => {
  it("lets the person in with the new password only, and ends their open sessions", async () => {
    const owner = await ownerWithRestaurant();
    const { member, email } = await createMember(owner, (await createRole(owner)).id);
    const open = await signedInClient(email);

    const res = await owner.client.put(`/api/members/${member.id}/password`, { password: "another-password-1" });
    expect(res.status).toBe(204);

    expect((await open.get("/api/restaurants/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/sign-in/email", { email, password: TEST_PASSWORD })).status).toBe(401);
    const fresh = new Client();
    expect((await fresh.post("/api/auth/sign-in/email", { email, password: "another-password-1" })).status).toBe(200);
    expect((await fresh.get("/api/restaurants/me")).status).toBe(200);
  });

  it("answers 422 for a short password and keeps the current one", async () => {
    const owner = await ownerWithRestaurant();
    const { member, email } = await createMember(owner, (await createRole(owner)).id);
    expect((await owner.client.put(`/api/members/${member.id}/password`, { password: "short" })).status).toBe(422);
    expect((await signedInClient(email)).hasSession).toBe(true);
  });
});

describe("DELETE /api/members/:id (scenario 28)", () => {
  it("removes the member, the account, its credentials and sessions, and frees the email", async () => {
    const owner = await ownerWithRestaurant();
    const role = await createRole(owner);
    const { member, email } = await createMember(owner, role.id);
    const staff = await signedInClient(email);
    const userId = (await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>())!.id;

    const res = await owner.client.delete(`/api/members/${member.id}`);
    expect(res.status).toBe(204);

    expect(await count("SELECT count(*) AS n FROM restaurant_members WHERE id = ?", member.id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM user WHERE id = ?", userId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM account WHERE user_id = ?", userId)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM session WHERE user_id = ?", userId)).toBe(0);
    expect((await staff.get("/api/restaurants/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/sign-in/email", { email, password: TEST_PASSWORD })).status).toBe(401);

    const again = await owner.client.post("/api/members", memberBody(role.id, { email }));
    expect(again.status).toBe(201);
  });
});

describe("members of other restaurants (scenario 29)", () => {
  it("answers 404 on every member route for an unknown id or one of another local, changing nothing", async () => {
    const owner = await ownerWithRestaurant();
    const other = await ownerWithRestaurant();
    const foreign = await createMember(other, (await createRole(other)).id);
    const requests = (id: string) => [
      owner.client.patch(`/api/members/${id}`, { firstName: "Hack" }),
      owner.client.patch(`/api/members/${id}/active`, { active: false }),
      owner.client.put(`/api/members/${id}/password`, { password: "another-password-1" }),
      owner.client.delete(`/api/members/${id}`),
    ];
    for (const id of [foreign.member.id, "no-such-member", other.memberId]) {
      for (const res of await Promise.all(requests(id))) {
        expect(res.status, id).toBe(404);
        expect(await errorCode(res)).toBe("MEMBER_NOT_FOUND");
      }
    }
    const intact = (await (await other.client.get("/api/members")).json()) as MemberList;
    expect(intact.members.find((m) => m.id === foreign.member.id)).toMatchObject({ firstName: "Ana", active: true });
    expect((await signedInClient(foreign.email)).hasSession).toBe(true);
  });
});

describe("owner only (scenario 30)", () => {
  it("answers 403 OWNER_ONLY to a member with every permission on /api/members and /api/roles", async () => {
    const owner = await ownerWithRestaurant();
    const { client } = await staffClient({ owner, permissions: [...ALL_PERMISSIONS] });
    const role = await createRole(owner);
    const { member } = await createMember(owner, role.id);
    const requests: [string, string, unknown?][] = [
      ["GET", "/api/members"],
      ["POST", "/api/members", memberBody(role.id)],
      ["PATCH", `/api/members/${member.id}`, { firstName: "Hack" }],
      ["PATCH", `/api/members/${member.id}/active`, { active: false }],
      ["PUT", `/api/members/${member.id}/password`, { password: "another-password-1" }],
      ["DELETE", `/api/members/${member.id}`],
      ["GET", "/api/roles"],
      ["POST", "/api/roles", { name: "Hack", permissions: [] }],
      ["PATCH", `/api/roles/${role.id}`, { active: false }],
      ["DELETE", `/api/roles/${role.id}`],
    ];
    for (const [method, path, body] of requests) {
      const res = await client.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await errorCode(res)).toBe("OWNER_ONLY");
    }
  });
});
