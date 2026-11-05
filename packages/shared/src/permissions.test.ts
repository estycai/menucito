import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  PERMISSION_SECTIONS,
  createMemberSchema,
  hasPermission,
  memberListQuerySchema,
  memberPasswordSchema,
  normalizeMemberPhone,
  normalizePermissions,
  roleSchema,
  updateMemberSchema,
  updateRoleSchema,
  validatePermissions,
  type Access,
  type PermissionKey,
} from "./permissions";

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => ({ path: issue.path, message: issue.message }));

describe("PERMISSION_SECTIONS (scenario 1)", () => {
  it("lists the six sections in menu order with their sub-permissions", () => {
    expect(
      PERMISSION_SECTIONS.map((section) => [section.key, section.label, section.subpermissions.map((sub) => sub.key)]),
    ).toEqual([
      ["summary.view", "Resumen", []],
      ["orders.view", "Pedidos", ["orders.status", "orders.payment", "orders.export"]],
      ["menu.view", "Mi menú", ["menu.edit"]],
      ["store.view", "Mi local", ["store.edit"]],
      ["qr.view", "Link y QR", []],
      ["stats.view", "Estadísticas", []],
    ]);
  });

  it("gives every key and sub-permission a label, a unique key and the <section>.<action> format", () => {
    const keys = PERMISSION_SECTIONS.flatMap((section) => [section, ...section.subpermissions]);
    expect(new Set(keys.map((entry) => entry.key)).size).toBe(keys.length);
    expect(ALL_PERMISSIONS).toHaveLength(keys.length);
    for (const entry of keys) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.key).toMatch(/^[a-z]+\.[a-z]+$/);
    }
    for (const section of PERMISSION_SECTIONS) {
      const prefix = section.key.split(".")[0];
      expect(section.key).toBe(`${prefix}.view`);
      for (const sub of section.subpermissions) expect(sub.key.startsWith(`${prefix}.`)).toBe(true);
    }
  });
});

describe("normalizePermissions (scenario 2)", () => {
  it("drops unknown keys, removes repeats and orders by the catalog", () => {
    expect(normalizePermissions(["orders.payment", "nope.view", "menu.view", "orders.view", "menu.view", "orders.payment"])).toEqual([
      "orders.view",
      "orders.payment",
      "menu.view",
    ]);
  });

  it("returns an empty list for no keys", () => {
    expect(normalizePermissions([])).toEqual([]);
  });
});

describe("validatePermissions (scenario 3)", () => {
  it("names the missing section key of a sub-permission", () => {
    expect(validatePermissions(["menu.edit"])).toMatchObject({ permission: "menu.edit", missing: "menu.view" });
    expect(validatePermissions(["orders.view", "store.edit"])).toMatchObject({ permission: "store.edit", missing: "store.view" });
  });

  it("accepts a sub-permission with its section, a section alone and the empty list", () => {
    expect(validatePermissions(["menu.view", "menu.edit"])).toBeNull();
    expect(validatePermissions(["stats.view"])).toBeNull();
    expect(validatePermissions([])).toBeNull();
  });

  it("ignores unknown keys", () => {
    expect(validatePermissions(["ghost.edit"])).toBeNull();
  });
});

describe("hasPermission (scenario 4)", () => {
  const member = (overrides: Partial<Access> = {}): Access => ({
    memberId: "m1",
    isOwner: false,
    active: true,
    role: { id: "r1", name: "Cajero", active: true },
    permissions: ["orders.view", "orders.payment"],
    ...overrides,
  });

  it("is true for the owner with any key", () => {
    const owner = member({ isOwner: true, permissions: [] });
    for (const key of ALL_PERMISSIONS) expect(hasPermission(owner, key)).toBe(true);
  });

  it("is false for an inactive member, even with the key", () => {
    expect(hasPermission(member({ active: false }), "orders.view")).toBe(false);
  });

  it("is false when the role is inactive", () => {
    expect(hasPermission(member({ role: { id: "r1", name: "Cajero", active: false } }), "orders.view")).toBe(false);
  });

  it("depends on the member keys otherwise", () => {
    expect(hasPermission(member(), "orders.payment")).toBe(true);
    expect(hasPermission(member(), "orders.status" satisfies PermissionKey)).toBe(false);
  });
});

describe("roleSchema (scenario 5)", () => {
  it("trims the name and normalizes the permissions", () => {
    const parsed = roleSchema.parse({ name: "  Cajero ", permissions: ["orders.payment", "orders.view", "ghost.view"] });
    expect(parsed).toEqual({ name: "Cajero", permissions: ["orders.view", "orders.payment"] });
  });

  it.each([[""], ["   "], ["x".repeat(41)]])("rejects the name %j", (name) => {
    expect(roleSchema.safeParse({ name, permissions: [] }).success).toBe(false);
  });

  it("accepts 40 characters", () => {
    expect(roleSchema.safeParse({ name: "x".repeat(40), permissions: [] }).success).toBe(true);
  });

  it.each([["Dueño"], ["dueño"], ["DUEÑO"], ["  dUeÑo "]])("rejects the reserved name %j", (name) => {
    expect(roleSchema.safeParse({ name, permissions: [] }).success).toBe(false);
  });

  it("rejects a sub-permission without its section, naming the missing key", () => {
    const result = roleSchema.safeParse({ name: "Mozo", permissions: ["menu.edit"] });
    expect(issues(result)).toEqual([{ path: ["permissions"], message: expect.stringContaining("menu.view") }]);
  });

  it("requires at least one field in an update and accepts an active switch alone", () => {
    expect(updateRoleSchema.safeParse({}).success).toBe(false);
    expect(updateRoleSchema.safeParse({ active: false }).success).toBe(true);
    expect(updateRoleSchema.safeParse({ permissions: ["menu.edit"] }).success).toBe(false);
  });
});

describe("createMemberSchema / updateMemberSchema (scenario 6)", () => {
  const valid = {
    firstName: " Ana ",
    lastName: "Pérez",
    email: "  Ana@Example.COM ",
    password: "password-123",
    roleId: "role-1",
  };

  it("trims the names, lowercases the email and defaults the optional fields", () => {
    expect(createMemberSchema.parse(valid)).toEqual({
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.com",
      password: "password-123",
      roleId: "role-1",
      isCourier: false,
      phone: null,
    });
  });

  it.each([
    ["firstName", ""],
    ["firstName", "x".repeat(61)],
    ["lastName", "  "],
    ["lastName", "x".repeat(61)],
    ["email", "not-an-email"],
    ["email", ""],
    ["password", "short"],
    ["password", "x".repeat(129)],
    ["roleId", ""],
  ])("rejects %s = %j", (field, value) => {
    expect(createMemberSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("accepts 8 and 128 character passwords", () => {
    expect(memberPasswordSchema.safeParse("x".repeat(8)).success).toBe(true);
    expect(memberPasswordSchema.safeParse("x".repeat(128)).success).toBe(true);
  });

  it("requires roleId", () => {
    const withoutRole: Partial<typeof valid> = { ...valid };
    delete withoutRole.roleId;
    expect(createMemberSchema.safeParse(withoutRole).success).toBe(false);
  });

  it("accepts isCourier", () => {
    expect(createMemberSchema.parse({ ...valid, isCourier: true }).isCourier).toBe(true);
  });

  it("updates without email or password and rejects them", () => {
    expect(updateMemberSchema.parse({ firstName: " Ana ", isCourier: true })).toEqual({ firstName: "Ana", isCourier: true });
    expect(updateMemberSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
    expect(updateMemberSchema.safeParse({ password: "password-123" }).success).toBe(false);
  });

  it("keeps phone untouched when it is not sent and clears it with null or blank", () => {
    expect("phone" in updateMemberSchema.parse({ firstName: "Ana" })).toBe(false);
    expect(updateMemberSchema.parse({ phone: null })).toEqual({ phone: null });
    expect(updateMemberSchema.parse({ phone: "  " })).toEqual({ phone: null });
  });
});

describe("member phone (scenario 7)", () => {
  it("normalizes +54 numbers to E.164", () => {
    expect(normalizeMemberPhone("+54", "11 1234 5678")).toBe("+5491112345678");
    const parsed = createMemberSchema.parse({
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.com",
      password: "password-123",
      roleId: "r",
      phonePrefix: "+54",
      phone: "11 1234 5678",
    });
    expect(parsed.phone).toBe("+5491112345678");
  });

  it("defaults the prefix to +54", () => {
    expect(updateMemberSchema.parse({ phone: "11 1234 5678" })).toEqual({ phone: "+5491112345678" });
  });

  it("accepts 6 to 14 digits with another prefix", () => {
    expect(normalizeMemberPhone("+598", "99 123 456")).toBe("+59899123456");
    expect(normalizeMemberPhone("+1", "123456")).toBe("+1123456");
    expect(normalizeMemberPhone("+1", "12345678901234")).toBe("+112345678901234");
  });

  it("rejects 5 digits or more than 14 with another prefix", () => {
    expect(normalizeMemberPhone("+598", "12345")).toBeNull();
    expect(normalizeMemberPhone("+598", "123456789012345")).toBeNull();
    expect(updateMemberSchema.safeParse({ phonePrefix: "+598", phone: "12345" }).success).toBe(false);
  });

  it("rejects an invalid Argentine number and a malformed prefix", () => {
    expect(normalizeMemberPhone("+54", "123")).toBeNull();
    expect(normalizeMemberPhone("54", "1112345678")).toBeNull();
    expect(issues(updateMemberSchema.safeParse({ phonePrefix: "abc", phone: "1112345678" }))).toEqual([
      { path: ["phonePrefix"], message: expect.any(String) },
    ]);
  });
});

describe("memberListQuerySchema", () => {
  it("defaults to the first page of 20 with no filters", () => {
    expect(memberListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("parses page, limit and the boolean filters", () => {
    expect(memberListQuerySchema.parse({ page: "2", limit: "50", courier: "true", active: "false" })).toEqual({
      page: 2,
      limit: 50,
      courier: true,
      active: false,
    });
  });

  it("rejects bad values", () => {
    expect(memberListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(memberListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(memberListQuerySchema.safeParse({ courier: "yes" }).success).toBe(false);
  });
});
