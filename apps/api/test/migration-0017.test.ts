import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { GRANTED_REPORT_PERMISSION_KEYS } from "@menucito/shared";

// Own database: the migration must run against a schema that stops just before 0017.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const migration = env.TEST_MIGRATIONS.find((entry) => entry.name.startsWith("0017"));

beforeAll(async () => {
  expect(migration).toBeDefined();
  const before = env.TEST_MIGRATIONS.filter((entry) => entry.name < "0017");
  await applyD1Migrations(db, before);

  await db.batch([
    db
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Marta', 'marta@example.com', 1, ?, ?)")
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES ('r1', 'u1', 'uno', 'Uno', '5491112345678', 1, 1, ?, ?)",
      )
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO roles (id, restaurant_id, name, is_system, active, created_at, updated_at) VALUES ('role-with', 'r1', 'Encargado', 0, 1, ?, ?)",
      )
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO roles (id, restaurant_id, name, is_system, active, created_at, updated_at) VALUES ('role-without', 'r1', 'Mozo', 0, 1, ?, ?)",
      )
      .bind(NOW, NOW),
    db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('role-with', 'stats.view')"),
    db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES ('role-without', 'menu.view')"),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

const permissionsOf = async (roleId: string) =>
  (
    await db
      .prepare("SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission")
      .bind(roleId)
      .all<{ permission: string }>()
  ).results.map((row) => row.permission);

describe("migration 0017_report_permissions", () => {
  it("gives every role that already saw Reports the 47 new keys", async () => {
    const permissions = await permissionsOf("role-with");
    expect(permissions).toHaveLength(48);
    expect(permissions).toContain("stats.view");
    for (const key of GRANTED_REPORT_PERMISSION_KEYS) expect(permissions).toContain(key);
  });

  it("leaves a role without stats.view untouched", async () => {
    expect(await permissionsOf("role-without")).toEqual(["menu.view"]);
  });

  it("does not duplicate rows when a grant is applied again", async () => {
    await db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('role-with', 'stats.amounts')").run();
    expect(await permissionsOf("role-with")).toHaveLength(48);
  });
});
