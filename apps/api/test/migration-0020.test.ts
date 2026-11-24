import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty and can be stopped just before 0020.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;
const migration = env.TEST_MIGRATIONS.find((entry) => entry.name.startsWith("0020"));

const columnsOf = async (table: string) =>
  (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((row) => row.name);

beforeAll(async () => {
  expect(migration).toBeDefined();
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((entry) => entry.name < "0020"));

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
        "INSERT INTO cash_sessions (id, restaurant_id, opened_at, opening_cash_cents, opened_by_name, closed_at) VALUES ('s1', 'r1', ?, 2000000, 'Ana', ?)",
      )
      .bind(NOW, NOW),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0020_cash_transfer_balance", () => {
  it("adds the four transfer columns to cash_sessions", async () => {
    expect(await columnsOf("cash_sessions")).toEqual(
      expect.arrayContaining([
        "opening_transfer_cents",
        "counted_transfer_cents",
        "expected_transfer_cents",
        "transfer_difference_cents",
      ]),
    );
  });

  it("defaults the opening to 0 on the existing rows and leaves the close columns null", async () => {
    const session = await db
      .prepare(
        "SELECT opening_transfer_cents, counted_transfer_cents, expected_transfer_cents, transfer_difference_cents FROM cash_sessions WHERE id = 's1'",
      )
      .first();
    expect(session).toEqual({
      opening_transfer_cents: 0,
      counted_transfer_cents: null,
      expected_transfer_cents: null,
      transfer_difference_cents: null,
    });
  });

  it("fills the opening with 0 when a new session omits it", async () => {
    await db
      .prepare(
        "INSERT INTO cash_sessions (id, restaurant_id, opened_at, opening_cash_cents, opened_by_name) VALUES ('s2', 'r1', ?, 0, 'Ana')",
      )
      .bind(NOW)
      .run();
    const session = await db
      .prepare("SELECT opening_transfer_cents FROM cash_sessions WHERE id = 's2'")
      .first<{ opening_transfer_cents: number }>();
    expect(session?.opening_transfer_cents).toBe(0);
  });
});
