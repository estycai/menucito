import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const columnsOf = async (db: D1Database, table: string) =>
  (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((c) => c.name);

describe("migration 0005_appearance", () => {
  it("moves the logo of every existing restaurant into restaurant_appearance before dropping the column", async () => {
    const db = env.MIGRATION_DB;
    const before = env.TEST_MIGRATIONS.filter((m) => m.name < "0005");
    const appearance = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0005"));
    expect(appearance).toHaveLength(1);

    await applyD1Migrations(db, before);
    expect(await columnsOf(db, "restaurants")).toContain("logo_url");

    const now = 1_700_000_000_000;
    const insertUser = db.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    );
    await db.batch([
      insertUser.bind("u1", "A", "a@example.com", now, now),
      insertUser.bind("u2", "B", "b@example.com", now, now),
      db
        .prepare(
          "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, logo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)",
        )
        .bind("r1", "u1", "uno", "Uno", "5491112345678", "/api/media/logos/r1/a.webp", now, now + 5),
      db
        .prepare(
          "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)",
        )
        .bind("r2", "u2", "dos", "Dos", "5491112345678", now, now),
    ]);

    await applyD1Migrations(db, appearance);

    expect(await columnsOf(db, "restaurants")).not.toContain("logo_url");
    expect(await columnsOf(db, "restaurant_appearance")).toEqual([
      "restaurant_id",
      "logo_url",
      "cover_url",
      "description",
      "bg_color",
      "primary_color",
      "updated_at",
    ]);

    const rows = (await db.prepare("SELECT * FROM restaurant_appearance ORDER BY restaurant_id").all()).results;
    expect(rows).toEqual([
      {
        restaurant_id: "r1",
        logo_url: "/api/media/logos/r1/a.webp",
        cover_url: null,
        description: "",
        bg_color: null,
        primary_color: null,
        updated_at: now + 5,
      },
      {
        restaurant_id: "r2",
        logo_url: null,
        cover_url: null,
        description: "",
        bg_color: null,
        primary_color: null,
        updated_at: now,
      },
    ]);
  });
});

describe("migration 0006_orders (scenario 8)", () => {
  it("backfills settings and payment methods for existing restaurants and creates orders tables empty", async () => {
    const db = env.MIGRATION_DB;
    const before = env.TEST_MIGRATIONS.filter((m) => m.name < "0006");
    const ordersMigration = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0006"));
    expect(ordersMigration).toHaveLength(1);

    await applyD1Migrations(db, before);

    const now = 1_700_000_000_000;
    const insertUser = db.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    );
    await db.batch([
      insertUser.bind("u3", "C", "c@example.com", now, now),
      db
        .prepare(
          "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
        )
        .bind("r3", "u3", "tres", "Tres", "5491112345678", now, now + 10),
      db
        .prepare("INSERT INTO restaurant_appearance (restaurant_id, description, updated_at) VALUES (?, '', ?)")
        .bind("r3", now + 10),
    ]);

    await applyD1Migrations(db, ordersMigration);

    // Check restaurant_settings backfill
    const settings = await db
      .prepare("SELECT * FROM restaurant_settings WHERE restaurant_id = ?")
      .bind("r3")
      .first<{
        restaurant_id: string;
        accepting_orders: number;
        min_order_cents: number | null;
        shipping_cents: number;
        updated_at: number;
      }>();
    expect(settings).toEqual({
      restaurant_id: "r3",
      accepting_orders: 1,
      min_order_cents: null,
      shipping_cents: 0,
      updated_at: now + 10,
    });

    // Check restaurant_payment_methods backfill
    const methods = (
      await db
        .prepare("SELECT * FROM restaurant_payment_methods WHERE restaurant_id = ? ORDER BY method")
        .bind("r3")
        .all<{
          restaurant_id: string;
          method: string;
          enabled: number;
          alias: string | null;
          holder_name: string | null;
        }>()
    ).results;
    expect(methods).toEqual([
      {
        restaurant_id: "r3",
        method: "cash",
        enabled: 1,
        alias: null,
        holder_name: null,
      },
      {
        restaurant_id: "r3",
        method: "transfer",
        enabled: 1,
        alias: null,
        holder_name: null,
      },
    ]);

    // Check new tables are created and empty
    for (const table of ["orders", "order_items", "customers", "promo_codes"]) {
      const count = await db.prepare(`SELECT count(*) as count FROM ${table}`).first<{ count: number }>();
      expect(count?.count).toBe(0);
    }
  });
});

describe("migration 0007_delivery_zones", () => {
  it("keeps existing settings and orders valid, defaulting to flat delivery, and adds the zone tables empty", async () => {
    const db = env.MIGRATION_DB;
    const before = env.TEST_MIGRATIONS.filter((m) => m.name < "0007");
    const zonesMigration = env.TEST_MIGRATIONS.filter((m) => m.name.startsWith("0007"));
    expect(zonesMigration).toHaveLength(1);

    await applyD1Migrations(db, before);

    const now = 1_700_000_000_000;
    await db.batch([
      db
        .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
        .bind("u4", "D", "d@example.com", now, now),
      db
        .prepare(
          "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
        )
        .bind("r4", "u4", "cuatro", "Cuatro", "5491112345678", now, now),
      db
        .prepare("INSERT INTO restaurant_settings (restaurant_id, shipping_cents, updated_at) VALUES (?, ?, ?)")
        .bind("r4", 150000, now),
      db
        .prepare(
          "INSERT INTO orders (id, restaurant_id, number, client_token, fulfillment, payment_method, customer_name, customer_phone, delivery_address, subtotal_cents, shipping_cents, total_cents, created_at, updated_at) VALUES (?, ?, 1, ?, 'delivery', 'cash', 'Ana', '5491112345678', 'Corrientes 1234', 500000, 150000, 650000, ?, ?)",
        )
        .bind("o1", "r4", "t1", now, now),
    ]);

    await applyD1Migrations(db, zonesMigration);

    const settings = await db.prepare("SELECT * FROM restaurant_settings WHERE restaurant_id = ?").bind("r4").first();
    expect(settings).toMatchObject({
      shipping_cents: 150000,
      delivery_mode: "flat",
      address: null,
      address_notes: null,
      lat: null,
      lng: null,
      place_id: null,
    });

    const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind("o1").first();
    expect(order).toMatchObject({
      delivery_address: "Corrientes 1234",
      shipping_cents: 150000,
      delivery_lat: null,
      delivery_lng: null,
      delivery_place_id: null,
      delivery_unit: null,
      delivery_between_streets: null,
      delivery_zone_id: null,
      delivery_zone_name: null,
      delivery_distance_m: null,
    });

    for (const table of ["delivery_zones", "customer_addresses"]) {
      const count = await db.prepare(`SELECT count(*) as count FROM ${table}`).first<{ count: number }>();
      expect(count?.count).toBe(0);
    }
  });

  it("clears the zone of an order when the zone is deleted", async () => {
    const db = env.MIGRATION_DB;
    await applyD1Migrations(db, env.TEST_MIGRATIONS);

    const now = 1_700_000_000_000;
    await db.batch([
      db.prepare("PRAGMA foreign_keys = ON"),
      db
        .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
        .bind("u5", "E", "e@example.com", now, now),
      db
        .prepare(
          "INSERT INTO restaurants (id, owner_id, slug, name, whatsapp, delivery, takeaway, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
        )
        .bind("r5", "u5", "cinco", "Cinco", "5491112345678", now, now),
      db
        .prepare(
          "INSERT INTO delivery_zones (id, restaurant_id, name, color, sort, shape, radius_m, pricing, price_cents, created_at, updated_at) VALUES (?, ?, 'Centro', '#C2410C', 0, 'radius', 3000, 'fixed', 50000, ?, ?)",
        )
        .bind("z1", "r5", now, now),
      db
        .prepare(
          "INSERT INTO orders (id, restaurant_id, number, client_token, fulfillment, payment_method, customer_name, customer_phone, subtotal_cents, shipping_cents, total_cents, delivery_zone_id, delivery_zone_name, created_at, updated_at) VALUES (?, ?, 1, ?, 'delivery', 'cash', 'Ana', '5491112345678', 500000, 50000, 550000, 'z1', 'Centro', ?, ?)",
        )
        .bind("o2", "r5", "t2", now, now),
    ]);

    await db.prepare("DELETE FROM delivery_zones WHERE id = ?").bind("z1").run();

    const order = await db.prepare("SELECT delivery_zone_id, delivery_zone_name FROM orders WHERE id = ?").bind("o2").first();
    expect(order).toEqual({ delivery_zone_id: null, delivery_zone_name: "Centro" });
  });
});
