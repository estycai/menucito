import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty and can be stopped just before 0014.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const columnsOf = async (table: string) =>
  (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((row) => row.name);

const tableExists = async (table: string) =>
  Boolean((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first()));

const insertSession = (id: string, closedAt: number | null) =>
  db
    .prepare(
      `INSERT INTO cash_sessions (id, restaurant_id, opened_at, opening_cash_cents, opened_by_name, closed_at)
       VALUES (?, 'r1', ?, 2000000, 'Ana', ?)`,
    )
    .bind(id, NOW, closedAt)
    .run();

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < "0014");
  expect(env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0014"))).toHaveLength(1);
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
        `INSERT INTO orders (id, restaurant_id, number, client_token, status, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, created_at, updated_at)
         VALUES ('o1', 'r1', 1, 'token-1', 'delivered', 'delivery', 'cash', 'Ana', '5491112345678', 500000, 50000, 550000, ?, ?)`,
      )
      .bind(NOW, NOW),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0014_cash_sessions", () => {
  it("creates the three cash tables and the new order columns", async () => {
    expect(await tableExists("cash_sessions")).toBe(true);
    expect(await tableExists("cash_movements")).toBe(true);
    expect(await tableExists("cash_session_totals")).toBe(true);
    expect(await columnsOf("orders")).toEqual(
      expect.arrayContaining(["paid_at", "cash_session_id", "settled_at", "settled_by_member_id"]),
    );
  });

  it("leaves the old orders outside every cash and unpaged", async () => {
    const row = await db
      .prepare("SELECT paid_at, cash_session_id, settled_at, settled_by_member_id FROM orders WHERE id = 'o1'")
      .first<{
        paid_at: number | null;
        cash_session_id: string | null;
        settled_at: number | null;
        settled_by_member_id: string | null;
      }>();
    expect(row).toEqual({ paid_at: null, cash_session_id: null, settled_at: null, settled_by_member_id: null });
  });

  it("keeps one open session per restaurant through the partial unique index", async () => {
    await insertSession("s1", null);
    await expect(insertSession("s2", null)).rejects.toThrow(/UNIQUE constraint failed/);

    await db.prepare("UPDATE cash_sessions SET closed_at = ? WHERE id = 's1'").bind(NOW + 1000).run();
    await insertSession("s2", null);
    await db.prepare("UPDATE cash_sessions SET closed_at = ? WHERE id = 's2'").bind(NOW + 2000).run();

    const sessions = await db
      .prepare("SELECT id FROM cash_sessions WHERE restaurant_id = 'r1' ORDER BY id")
      .all<{ id: string }>();
    expect(sessions.results.map((session) => session.id)).toEqual(["s1", "s2"]);
  });

  it("stores the totals snapshot and the movement links", async () => {
    expect(await columnsOf("cash_session_totals")).toEqual(
      expect.arrayContaining([
        "session_id",
        "method",
        "sales_count",
        "sales_cents",
        "income_count",
        "income_cents",
        "expense_count",
        "expense_cents",
        "tip_count",
        "tip_cents",
      ]),
    );
    expect(await columnsOf("cash_movements")).toEqual(
      expect.arrayContaining(["group_id", "order_id", "courier_member_id", "voided_at", "edited_at"]),
    );
    const indexNames = (
      await db.prepare("SELECT name FROM pragma_index_list('cash_sessions')").all<{ name: string }>()
    ).results.map((row) => row.name);
    expect(indexNames).toContain("cash_sessions_one_open_per_restaurant");
  });
});
