import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty (every file gets its own storage) and can be stopped just
// before 0012, which `migrations.test.ts` cannot do once an earlier test applied every migration.

const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const columnsOf = async (table: string) =>
  (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((row) => row.name);

const indexNames = async (table: string) =>
  (await db.prepare(`SELECT name FROM pragma_index_list('${table}')`).all<{ name: string }>()).results.map((row) => row.name);

const tableCounts = async (tables: string[]) =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [table, (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n] as const),
    ),
  );

const UNTOUCHED_TABLES = ["user", "restaurants", "restaurant_members", "roles", "order_items", "customers"];

const insertOrder = (id: string, number: number, status: string, createdAt: number, updatedAt: number) =>
  db
    .prepare(
      `INSERT INTO orders (id, restaurant_id, number, client_token, status, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, created_at, updated_at)
       VALUES (?, 'r1', ?, ?, ?, 'delivery', 'cash', 'Ana', '5491112345678', 500000, 50000, 550000, ?, ?)`,
    )
    .bind(id, number, `token-${number}`, status, createdAt, updatedAt);

let countsBefore: Record<string, number>;

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < "0012");
  expect(env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0012"))).toHaveLength(1);
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
    // Every status the column can take, so the backfill is checked against delivered and the rest.
    insertOrder("o-new", 1, "new", NOW + 10, NOW + 11),
    insertOrder("o-preparing", 2, "preparing", NOW + 20, NOW + 21),
    insertOrder("o-ready", 3, "ready", NOW + 30, NOW + 31),
    insertOrder("o-sent", 4, "sent", NOW + 40, NOW + 41),
    insertOrder("o-delivered", 5, "delivered", NOW + 50, NOW + 55),
    insertOrder("o-cancelled", 6, "cancelled", NOW + 60, NOW + 66),
  ]);

  countsBefore = await tableCounts(UNTOUCHED_TABLES);
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0012_couriers_and_tips (scenario 7)", () => {
  it("adds the courier, tip and timestamp columns and their indexes", async () => {
    const columns = await columnsOf("orders");
    expect(columns).toEqual(
      expect.arrayContaining(["courier_member_id", "tip_cents", "sent_at", "delivered_at"]),
    );
    const indexes = await indexNames("orders");
    expect(indexes).toContain("orders_restaurant_courier_status_idx");
    expect(indexes).toContain("orders_restaurant_delivered_idx");
  });

  it("starts every order with tip 0 and no courier, sent_at or delivered_at", async () => {
    const rows = (
      await db
        .prepare("SELECT id, courier_member_id, tip_cents, sent_at, delivered_at FROM orders ORDER BY number")
        .all<{ id: string; courier_member_id: string | null; tip_cents: number; sent_at: number | null; delivered_at: number | null }>()
    ).results;
    expect(rows.map((row) => row.id)).toEqual(["o-new", "o-preparing", "o-ready", "o-sent", "o-delivered", "o-cancelled"]);
    for (const row of rows) {
      expect(row.tip_cents).toBe(0);
      expect(row.courier_member_id).toBeNull();
      expect(row.sent_at).toBeNull();
    }
  });

  it("fills delivered_at with updated_at only for the delivered orders", async () => {
    const rows = (
      await db.prepare("SELECT id, status, updated_at, delivered_at FROM orders ORDER BY number").all<{
        id: string;
        status: string;
        updated_at: number;
        delivered_at: number | null;
      }>()
    ).results;
    for (const row of rows) {
      if (row.status === "delivered") expect(row.delivered_at).toBe(row.updated_at);
      else expect(row.delivered_at).toBeNull();
    }
  });

  it("does not change any other order field or any other table", async () => {
    const rows = (
      await db
        .prepare("SELECT id, number, status, payment_status, subtotal_cents, shipping_cents, total_cents FROM orders ORDER BY number")
        .all()
    ).results;
    expect(rows).toEqual([
      { id: "o-new", number: 1, status: "new", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
      { id: "o-preparing", number: 2, status: "preparing", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
      { id: "o-ready", number: 3, status: "ready", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
      { id: "o-sent", number: 4, status: "sent", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
      { id: "o-delivered", number: 5, status: "delivered", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
      { id: "o-cancelled", number: 6, status: "cancelled", payment_status: "pending", subtotal_cents: 500000, shipping_cents: 50000, total_cents: 550000 },
    ]);
    expect(await tableCounts(UNTOUCHED_TABLES)).toEqual(countsBefore);
  });
});