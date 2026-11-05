import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty (every file gets its own storage) and can be stopped just
// before 0011, which `migrations.test.ts` cannot do once an earlier test applied every migration.

const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const insertUser = (id: string, name: string, email: string) =>
  db
    .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(id, name, email, NOW, NOW);

const insertRestaurant = (id: string, ownerId: string, slug: string, createdAt: number) =>
  db
    .prepare(
      "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
    )
    .bind(id, ownerId, slug, slug, "5491112345678", createdAt, createdAt);

const tableCounts = async (tables: string[]) =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [table, (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n] as const),
    ),
  );

const UNTOUCHED_TABLES = ["user", "restaurants", "restaurant_appearance", "restaurant_settings", "restaurant_payment_methods", "categories", "products", "orders"];

let countsBefore: Record<string, number>;

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((m) => m.name < "0011");
  expect(env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0011"))).toHaveLength(1);
  await applyD1Migrations(db, before);

  await db.batch([
    insertUser("u1", "Marta Gómez", "marta@example.com"),
    insertUser("u2", "Juan Carlos Pérez", "juan@example.com"),
    insertUser("u3", "Madonna", "madonna@example.com"),
    insertUser("u4", "  Lucía   Ruiz ", "lucia@example.com"),
    insertRestaurant("r1", "u1", "uno", NOW + 1),
    insertRestaurant("r2", "u2", "dos", NOW + 2),
    insertRestaurant("r3", "u3", "tres", NOW + 3),
    insertRestaurant("r4", "u4", "cuatro", NOW + 4),
  ]);
  countsBefore = await tableCounts(UNTOUCHED_TABLES);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0011_members_and_roles (scenario 8)", () => {
  it("gives every restaurant its system role 'Dueño' (one each, active, no permission rows)", async () => {
    const rows = (
      await db
        .prepare("SELECT restaurant_id, name, is_system, active, created_at FROM roles ORDER BY restaurant_id")
        .all<{ restaurant_id: string; name: string; is_system: number; active: number; created_at: number }>()
    ).results;
    expect(rows).toEqual(
      ["r1", "r2", "r3", "r4"].map((id, index) => ({
        restaurant_id: id,
        name: "Dueño",
        is_system: 1,
        active: 1,
        created_at: NOW + index + 1,
      })),
    );
    expect((await db.prepare("SELECT count(*) AS n FROM role_permissions").first<{ n: number }>())!.n).toBe(0);
  });

  it("makes each owner an active owner member of the system role, with the account name split in two", async () => {
    const rows = (
      await db
        .prepare(
          `SELECT m.restaurant_id, m.user_id, m.first_name, m.last_name, m.phone, m.is_owner, m.is_courier, m.active, r.name AS role_name, r.is_system
           FROM restaurant_members m JOIN roles r ON r.id = m.role_id ORDER BY m.restaurant_id`,
        )
        .all()
    ).results;
    const member = (restaurantId: string, userId: string, firstName: string, lastName: string) => ({
      restaurant_id: restaurantId,
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      phone: null,
      is_owner: 1,
      is_courier: 0,
      active: 1,
      role_name: "Dueño",
      is_system: 1,
    });
    expect(rows).toEqual([
      member("r1", "u1", "Marta", "Gómez"),
      member("r2", "u2", "Juan", "Carlos Pérez"),
      member("r3", "u3", "Madonna", ""),
      member("r4", "u4", "Lucía", "Ruiz"),
    ]);
  });

  it("uses distinct UUID-shaped ids", async () => {
    const ids = (await db.prepare("SELECT id FROM roles UNION ALL SELECT id FROM restaurant_members").all<{ id: string }>()).results.map(
      (row) => row.id,
    );
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("leaves the other tables as they were", async () => {
    expect(await tableCounts(UNTOUCHED_TABLES)).toEqual(countsBefore);
  });
});

describe("migration 0011_members_and_roles (scenario 9)", () => {
  const roleOf = async (restaurantId: string) =>
    (await db.prepare("SELECT id FROM roles WHERE restaurant_id = ?").bind(restaurantId).first<{ id: string }>())!.id;

  const insertMember = (id: string, restaurantId: string, userId: string, roleId: string) =>
    db
      .prepare(
        "INSERT INTO restaurant_members (id, restaurant_id, user_id, role_id, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, 'A', 'B', ?, ?)",
      )
      .bind(id, restaurantId, userId, roleId, NOW, NOW);

  const insertRole = (id: string, restaurantId: string, name: string) =>
    db
      .prepare("INSERT INTO roles (id, restaurant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, restaurantId, name, NOW, NOW);

  it("rejects a second member row for the same user (UNIQUE user_id)", async () => {
    await db.prepare("DELETE FROM restaurant_members WHERE user_id = 'u1'").run();
    await insertMember("m-a", "r1", "u1", await roleOf("r1")).run();
    await expect(insertMember("m-b", "r2", "u1", await roleOf("r2")).run()).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rejects two roles with the same name in a restaurant, ignoring case, but allows it across restaurants", async () => {
    await insertRole("ro-1", "r1", "Cajero").run();
    await expect(insertRole("ro-2", "r1", "cajero").run()).rejects.toThrow(/UNIQUE constraint failed/);
    await insertRole("ro-3", "r2", "Cajero").run();
  });

  it("keeps a role while a member uses it, and deletes its permission rows with it", async () => {
    await insertUser("u5", "Staff", "staff@example.com").run();
    await insertRole("ro-4", "r3", "Mozo").run();
    await db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('ro-4', 'orders.view')").run();
    await insertMember("m-c", "r3", "u5", "ro-4").run();
    await expect(db.prepare("DELETE FROM roles WHERE id = 'ro-4'").run()).rejects.toThrow(/FOREIGN KEY constraint failed/);

    await db.prepare("DELETE FROM restaurant_members WHERE id = 'm-c'").run();
    await db.prepare("DELETE FROM roles WHERE id = 'ro-4'").run();
    expect((await db.prepare("SELECT count(*) AS n FROM role_permissions WHERE role_id = 'ro-4'").first<{ n: number }>())!.n).toBe(0);
  });

  it("deletes the roles and members of a restaurant with it (no FK deadlock between them)", async () => {
    await db.prepare("DELETE FROM restaurants WHERE id = 'r4'").run();
    expect((await db.prepare("SELECT count(*) AS n FROM roles WHERE restaurant_id = 'r4'").first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare("SELECT count(*) AS n FROM restaurant_members WHERE restaurant_id = 'r4'").first<{ n: number }>())!.n).toBe(0);
  });
});
