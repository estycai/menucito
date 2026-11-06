import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own file so `MIGRATION_DB` starts empty and can be stopped just before 0016.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

beforeAll(async () => {
  const before = env.TEST_MIGRATIONS.filter((migration) => migration.name < "0016");
  expect(env.TEST_MIGRATIONS.filter((migration) => migration.name.startsWith("0016"))).toHaveLength(1);
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
         VALUES ('o1', 'r1', 1, 'token-1', 'new', 'takeaway', 'cash', 'Ana', '5491112345678', 500000, 0, 500000, ?, ?)`,
      )
      .bind(NOW, NOW),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0016_order_source_notes", () => {
  it("adds source with web as the default for the existing orders", async () => {
    const row = await db.prepare("SELECT source, notes FROM orders WHERE id = 'o1'").first<{
      source: string;
      notes: string | null;
    }>();
    expect(row).toEqual({ source: "web", notes: null });
  });

  it("keeps notes as an optional text column and stores the new source", async () => {
    await db
      .prepare("UPDATE orders SET source = 'whatsapp', notes = 'timbre 2B' WHERE id = 'o1'")
      .run();
    const row = await db.prepare("SELECT source, notes FROM orders WHERE id = 'o1'").first<{
      source: string;
      notes: string | null;
    }>();
    expect(row).toEqual({ source: "whatsapp", notes: "timbre 2B" });
  });
});
