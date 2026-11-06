import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty and can be stopped just before 0015.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const insertTemplate = (restaurantId: string, fulfillment: string, targetStatus: string, body: string) =>
  db
    .prepare(
      `INSERT INTO order_message_templates (restaurant_id, fulfillment, target_status, body, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(restaurantId, fulfillment, targetStatus, body, NOW)
    .run();

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < "0015");
  expect(env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0015"))).toHaveLength(1);
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
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0015_order_message_templates", () => {
  it("creates the empty table with the composite primary key", async () => {
    const rows = await db.prepare("SELECT * FROM order_message_templates").all();
    expect(rows.results).toEqual([]);

    const columns = (
      await db.prepare("SELECT name, pk FROM pragma_table_info('order_message_templates')").all<{
        name: string;
        pk: number;
      }>()
    ).results;
    expect(columns.map((column) => column.name)).toEqual([
      "restaurant_id",
      "fulfillment",
      "target_status",
      "body",
      "updated_at",
    ]);
    expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
      "restaurant_id",
      "fulfillment",
      "target_status",
    ]);
  });

  it("allows one message per restaurant, fulfillment and destination status", async () => {
    await insertTemplate("r1", "delivery", "preparing", "Hola");
    await expect(insertTemplate("r1", "delivery", "preparing", "Otra")).rejects.toThrow(/UNIQUE constraint failed/);
    await insertTemplate("r1", "takeaway", "preparing", "Hola");
  });
});
