import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// Own database: the migration must run against a schema that stops just before 0018.
const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;

const migration = env.TEST_MIGRATIONS.find((entry) => entry.name.startsWith("0018"));

beforeAll(async () => {
  expect(migration).toBeDefined();
  const before = env.TEST_MIGRATIONS.filter((entry) => entry.name < "0018");
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
      .prepare("INSERT INTO customers (id, restaurant_id, name, phone, address, notes, first_order_at, created_at, updated_at) VALUES ('ghost', 'r1', 'Mostrador', '', NULL, NULL, ?, ?, ?)")
      .bind(NOW, NOW, NOW),
    db
      .prepare("INSERT INTO customers (id, restaurant_id, name, phone, address, notes, first_order_at, created_at, updated_at) VALUES ('real', 'r1', 'Juan', '5491122679246', 'Calle 1', 'Timbre', ?, ?, ?)")
      .bind(NOW, NOW, NOW),
    db
      .prepare(
        "INSERT INTO orders (id, restaurant_id, customer_id, number, client_token, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, created_at, updated_at) VALUES ('o1', 'r1', 'ghost', 1, 't1', 'takeaway', 'cash', 'Mostrador', '', 100000, 0, 100000, ?, ?)",
      )
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO orders (id, restaurant_id, customer_id, number, client_token, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, created_at, updated_at) VALUES ('o2', 'r1', 'real', 2, 't2', 'takeaway', 'cash', 'Juan', '5491122679246', 100000, 0, 100000, ?, ?)",
      )
      .bind(NOW, NOW),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0018_customers", () => {
  it("removes the ghost customer and leaves its orders without a customer", async () => {
    const ghost = await db.prepare("SELECT id FROM customers WHERE id = 'ghost'").first();
    expect(ghost).toBeNull();

    const order = await db.prepare("SELECT customer_id, customer_name FROM orders WHERE id = 'o1'").first();
    expect(order).toEqual({ customer_id: null, customer_name: "Mostrador" });
  });

  it("leaves the real customers untouched and without WhatsApp permission", async () => {
    const real = await db
      .prepare("SELECT id, name, phone, address, notes, whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out FROM customers WHERE id = 'real'")
      .first();
    expect(real).toEqual({
      id: "real",
      name: "Juan",
      phone: "5491122679246",
      address: "Calle 1",
      notes: "Timbre",
      whatsapp_opt_in_at: null,
      whatsapp_opt_in_source: null,
      whatsapp_opt_out: 0,
    });

    const order = await db.prepare("SELECT customer_id FROM orders WHERE id = 'o2'").first();
    expect(order).toEqual({ customer_id: "real" });
  });

  it("creates the tag tables empty", async () => {
    for (const table of ["customer_tags", "customer_tag_links"]) {
      const count = await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
      expect(count?.count).toBe(0);
    }
  });
});
