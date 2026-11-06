import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own database (each test file gets its own storage) so the migrations can stop just before 0013.

const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const columnsOf = async (table: string) =>
  (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((row) => row.name);

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < "0013");
  expect(env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0013"))).toHaveLength(1);
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
         VALUES ('o1', 'r1', 1, 'token-1', 'new', 'delivery', 'split', 'Ana', '5491112345678', 500000, 0, 500000, ?, ?)`,
      )
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO restaurant_payment_methods (restaurant_id, method, enabled, alias, holder_name) VALUES ('r1', 'cash', 1, NULL, NULL)",
      ),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0013_payment_split", () => {
  it("adds the split cash part and tendered columns, null on existing orders", async () => {
    const columns = await columnsOf("orders");
    expect(columns).toEqual(expect.arrayContaining(["split_cash_cents", "cash_tendered_cents"]));

    const row = await db
      .prepare("SELECT split_cash_cents, cash_tendered_cents FROM orders WHERE id = 'o1'")
      .first<{ split_cash_cents: number | null; cash_tendered_cents: number | null }>();
    expect(row).toEqual({ split_cash_cents: null, cash_tendered_cents: null });
  });

  it("does not create a split row in restaurant_payment_methods", async () => {
    const count = await db
      .prepare("SELECT count(*) AS n FROM restaurant_payment_methods WHERE method = 'split'")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
