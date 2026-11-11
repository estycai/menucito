import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;
const db = env.MIGRATION_DB;
const migration = env.TEST_MIGRATIONS.find((entry) => entry.name.startsWith("0019"));

beforeAll(async () => {
  expect(migration).toBeDefined();
  await applyD1Migrations(db, env.TEST_MIGRATIONS.filter((entry) => entry.name < "0019"));

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
      .prepare("INSERT INTO customers (id, restaurant_id, name, phone, created_at, updated_at) VALUES ('c1', 'r1', 'Juan', '5491122679246', ?, ?)")
      .bind(NOW, NOW),
    db
      .prepare(
        "INSERT INTO orders (id, restaurant_id, customer_id, number, client_token, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, created_at, updated_at) VALUES ('o1', 'r1', 'c1', 1, 't1', 'takeaway', 'cash', 'Juan', '5491122679246', 100000, 0, 100000, ?, ?)",
      )
      .bind(NOW, NOW),
  ]);

  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

describe("migration 0019_whatsapp", () => {
  it("adds the WhatsApp columns to customers without touching their data", async () => {
    const customer = await db
      .prepare("SELECT id, name, phone, wa_last_inbound_at, wa_bsuid FROM customers WHERE id = 'c1'")
      .first();
    expect(customer).toEqual({
      id: "c1",
      name: "Juan",
      phone: "5491122679246",
      wa_last_inbound_at: null,
      wa_bsuid: null,
    });
  });

  it("creates the connection and notice tables empty", async () => {
    for (const table of ["whatsapp_connections", "order_notifications"]) {
      const count = await db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>();
      expect(count?.count).toBe(0);
    }
  });

  it("keeps one notice per order and transition and one connection per phone number", async () => {
    await db
      .prepare(
        "INSERT INTO whatsapp_connections (restaurant_id, waba_id, phone_number_id, display_phone, display_name, connected_at, updated_at) VALUES ('r1', 'w1', 'p1', '5491100000000', 'Uno', ?, ?)",
      )
      .bind(NOW, NOW)
      .run();
    await expect(
      db
        .prepare(
          "INSERT INTO whatsapp_connections (restaurant_id, waba_id, phone_number_id, display_phone, display_name, connected_at, updated_at) VALUES ('r1', 'w2', 'p1', '5491100000001', 'Dos', ?, ?)",
        )
        .bind(NOW, NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE/);

    const insertNotice = (id: string) =>
      db
        .prepare(
          "INSERT INTO order_notifications (id, restaurant_id, order_id, target_status, channel, status, body, created_at, updated_at) VALUES (?, 'r1', 'o1', 'preparing', 'text', 'sent', 'Hola', ?, ?)",
        )
        .bind(id, NOW, NOW)
        .run();
    await insertNotice("n1");
    await expect(insertNotice("n2")).rejects.toThrow(/UNIQUE/);
  });
});
