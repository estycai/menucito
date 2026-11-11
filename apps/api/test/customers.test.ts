import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateKey, localDayRange, type Category, type CustomerDetail, type CustomerList, type CustomersHeatmap, type CustomerOrdersPage, type CustomerTag, type Product } from "@menucito/shared";
import { Client, errorCode, ownerWithRestaurant, signedInClient, staffClient, type OwnerFixture } from "./helpers";

const PRICE = 500_000;
const TODAY = localDateKey(Date.now());

let phoneSequence = 0;
const nextPhone = () => `11 ${String(10_000_000 + phoneSequence++).slice(-8)}`;

async function createCatalog(owner: OwnerFixture): Promise<Product> {
  const categoryRes = await owner.client.post("/api/categories", { name: "Burgers" });
  expect(categoryRes.status).toBe(201);
  const category = (await categoryRes.json()) as Category;
  const productRes = await owner.client.post("/api/products", {
    categoryId: category.id,
    name: "Hamburguesa clásica",
    description: "",
    priceCents: PRICE,
    available: true,
  });
  expect(productRes.status).toBe(201);
  return (await productRes.json()) as Product;
}

interface SeedOptions {
  name?: string;
  phone?: string;
  quantity?: number;
  date?: string;
  status?: string;
  paymentStatus?: string;
  productId?: string;
}

/** Places an order through the public menu and stamps its status/date directly (report-fixture style). */
async function seedOrder(owner: OwnerFixture, product: Product, options: SeedOptions = {}) {
  const quantity = options.quantity ?? 1;
  const phone = options.phone ?? nextPhone();
  const token = crypto.randomUUID();
  const res = await new Client().post(`/api/public/menus/${owner.slug}/orders`, {
    items: [{ productId: options.productId ?? product.id, quantity }],
    customer: { name: options.name ?? "Ana", phone, address: null },
    fulfillment: "takeaway",
    paymentMethod: "cash",
    clientOrderId: token,
    expectedTotalCents: PRICE * quantity,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { order: { number: number } };
  const row = await env.DB.prepare("SELECT id FROM orders WHERE client_token = ?").bind(token).first<{ id: string }>();
  const orderId = row!.id;
  const createdAt = localDayRange(options.date ?? TODAY)[0] + 12 * 60 * 60 * 1000;
  await env.DB.prepare("UPDATE orders SET status = ?, payment_status = ?, created_at = ?, updated_at = ? WHERE id = ?")
    .bind(
      options.status ?? "delivered",
      options.paymentStatus ?? "paid",
      createdAt,
      createdAt,
      orderId,
    )
    .run();
  const customer = await env.DB.prepare("SELECT id FROM customers WHERE restaurant_id = ? AND phone = ?")
    .bind(owner.restaurantId, phone.replace(/\D/g, "").replace(/^(\d{2})(\d{8})$/, "549$1$2"))
    .first<{ id: string }>();
  return { orderId, number: body.order.number, customerId: customer?.id, phone, createdAt };
}

const list = async (owner: OwnerFixture, query = "") => {
  const res = await owner.client.get(`/api/customers${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as CustomerList;
};

const detail = async (owner: OwnerFixture, id: string) => {
  const res = await owner.client.get(`/api/customers/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as CustomerDetail;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("GET /api/customers: list and indicators", () => {
  it("computes orders, spent and last order: cancelled and unpaid stay out of the money", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const phone = nextPhone();

    await seedOrder(owner, product, { phone, quantity: 1, date: "2026-10-01" });
    await seedOrder(owner, product, { phone, quantity: 2, date: "2026-10-20" });
    await seedOrder(owner, product, { phone, quantity: 1, date: "2026-10-25", status: "cancelled", paymentStatus: "pending" });
    await seedOrder(owner, product, { phone, quantity: 1, date: "2026-09-01", paymentStatus: "pending" });

    const result = await list(owner);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ phone: expect.stringMatching(/^549/), orders: 3, spentCents: 1_500_000, lastOrderAt: localDayRange("2026-10-20")[0] + 12 * 60 * 60 * 1000 });
  });

  it("searches by name and phone with any formatting, and filters by date, product and tag", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const ana = await seedOrder(owner, product, { name: "Ana Pérez", phone: "11 2267-9246", date: "2026-11-05" });
    const beto = await seedOrder(owner, product, { name: "Beto Gómez", phone: "11 5555-1234", date: "2026-10-10" });
    await seedOrder(owner, product, { name: "Carla", date: "2026-09-01", status: "cancelled", paymentStatus: "pending" });

    expect((await list(owner, "?q=ana")).items.map((item) => item.name)).toEqual(["Ana Pérez"]);
    expect((await list(owner, "?q=1122679246")).items.map((item) => item.name)).toEqual(["Ana Pérez"]);
    expect((await list(owner, "?q=11%202267-9246")).items.map((item) => item.name)).toEqual(["Ana Pérez"]);
    expect((await list(owner, "?from=2026-10-01&to=2026-11-05")).items.map((item) => item.name)).toEqual([
      "Ana Pérez",
      "Beto Gómez",
    ]);
    expect((await list(owner, `?product=${product.id}`)).total).toBe(2);

    const tagRes = await owner.client.post("/api/customer-tags", { name: "VIP", color: "purple" });
    expect(tagRes.status).toBe(201);
    const tag = (await tagRes.json()) as CustomerTag;
    expect(
      (await owner.client.patch(`/api/customers/${beto.customerId}`, { tagIds: [tag.id] })).status,
    ).toBe(200);
    expect((await list(owner, `?tag=${tag.id}`)).items.map((item) => item.name)).toEqual(["Beto Gómez"]);
    expect((await list(owner, `?tag=${tag.id}`)).items[0]?.tags).toEqual([tag]);
    expect(ana.customerId).toBeTruthy();
  });

  it("sorts by orders, spent, last, since and name, and paginates 25 per page", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const anaPhone = nextPhone();
    await seedOrder(owner, product, { name: "Ana", phone: anaPhone, date: "2026-11-01" });
    await seedOrder(owner, product, { name: "Ana", phone: anaPhone, date: "2026-11-02" });
    await seedOrder(owner, product, { name: "Beto", quantity: 3, date: "2026-10-01" });
    await seedOrder(owner, product, { name: "Carla", date: "2026-09-01", status: "cancelled", paymentStatus: "pending" });

    expect((await list(owner)).items.map((item) => item.name)).toEqual(["Ana", "Beto", "Carla"]);
    expect((await list(owner, "?sort=spent&dir=asc")).items.map((item) => item.name)).toEqual(["Carla", "Ana", "Beto"]);
    expect((await list(owner, "?sort=spent&dir=desc")).items[0]?.name).toBe("Beto");
    expect((await list(owner, "?sort=last&dir=asc")).items[0]?.name).toBe("Carla");
    expect((await list(owner, "?sort=since&dir=asc")).items[0]?.name).toBe("Carla");
    expect((await list(owner, "?sort=name&dir=asc")).items.map((item) => item.name)).toEqual(["Ana", "Beto", "Carla"]);

    for (let index = 0; index < 30; index++) {
      await env.DB.prepare("INSERT INTO customers (id, restaurant_id, name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`page-${index}`, owner.restaurantId, `Cliente ${String(index).padStart(2, "0")}`, `549110000${String(index).padStart(4, "0")}`, Date.now(), Date.now())
        .run();
    }
    const first = await list(owner);
    expect(first.total).toBe(33);
    expect(first.items).toHaveLength(25);
    const second = await list(owner, "?page=2");
    expect(second.items).toHaveLength(8);
  });

  it("a date filter chooses customers but does not trim their numbers", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const phone = nextPhone();
    await seedOrder(owner, product, { phone, date: "2026-10-01" });
    await seedOrder(owner, product, { phone, quantity: 2, date: "2026-11-05" });

    const result = await list(owner, "?from=2026-10-01&to=2026-10-31");
    expect(result.items[0]).toMatchObject({ orders: 2, spentCents: 1_500_000 });
  });
});

describe("customer sheet", () => {
  it("returns the five indicators, the tag list and the order history with products", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const phone = nextPhone();
    const first = await seedOrder(owner, product, { phone, quantity: 2, date: "2026-09-01" });
    await seedOrder(owner, product, { phone, quantity: 1, date: "2026-10-01" });
    await seedOrder(owner, product, { phone, quantity: 1, date: "2026-10-02", status: "cancelled", paymentStatus: "pending" });

    const sheet = await detail(owner, first.customerId!);
    expect(sheet).toMatchObject({
      name: "Ana",
      phone: expect.stringMatching(/^549/),
      orders: 2,
      spentCents: 1_500_000,
      averageTicketCents: 750_000,
      firstOrderAt: localDayRange("2026-09-01")[0] + 12 * 60 * 60 * 1000,
      lastOrderAt: localDayRange("2026-10-01")[0] + 12 * 60 * 60 * 1000,
    });

    const historyRes = await owner.client.get(`/api/customers/${first.customerId}/orders`);
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as CustomerOrdersPage;
    expect(history.total).toBe(2);
    expect(history.items).toHaveLength(2);
    expect(history.items[0]).toMatchObject({
      number: expect.any(Number),
      fulfillment: "takeaway",
      totalCents: PRICE,
      itemCount: 1,
      items: [{ name: "Hamburguesa clásica", quantity: 1 }],
    });
  });

  it("edits the name, phone, notes and opt-out, and rejects a phone of another customer", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const one = await seedOrder(owner, product, { name: "Ana", phone: "11 5555-1111" });
    const two = await seedOrder(owner, product, { name: "Beto", phone: "11 5555-2222" });

    const clash = await owner.client.patch(`/api/customers/${two.customerId}`, { phone: "11 5555-1111" });
    expect(clash.status).toBe(409);
    const clashBody = (await clash.json()) as { error: { code: string; name: string } };
    expect(clashBody.error.code).toBe("PHONE_IN_USE");
    expect(clashBody.error.name).toBe("Ana");

    const updated = await owner.client.patch(`/api/customers/${one.customerId}`, {
      name: "Ana María",
      phone: "11 5555-9999",
      notes: "  Tocar timbre  ",
      whatsappOptOut: true,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      name: "Ana María",
      phone: "5491155559999",
      notes: "Tocar timbre",
      whatsappOptOut: true,
    });
  });

  it("deletes a saved address and a tag from every customer", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const seeded = await seedOrder(owner, product, {});
    const customerId = seeded.customerId!;
    await env.DB.prepare(
      `INSERT INTO customer_addresses (id, restaurant_id, customer_id, label, formatted_address, lat, lng, created_at, last_used_at)
       VALUES ('addr-1', ?, ?, 'home', 'Calle 1', -34.6, -58.4, ?, ?)`,
    )
      .bind(owner.restaurantId, customerId, Date.now(), Date.now())
      .run();

    expect((await owner.client.delete(`/api/customers/${customerId}/addresses/addr-1`)).status).toBe(204);
    expect(await env.DB.prepare("SELECT id FROM customer_addresses WHERE id = 'addr-1'").first()).toBeNull();

    const tagRes = await owner.client.post("/api/customer-tags", { name: "VIP", color: "blue" });
    const tag = (await tagRes.json()) as CustomerTag;
    await owner.client.patch(`/api/customers/${customerId}`, { tagIds: [tag.id] });
    expect((await owner.client.delete(`/api/customer-tags/${tag.id}`)).status).toBe(204);
    const links = await env.DB.prepare("SELECT count(*) AS count FROM customer_tag_links WHERE tag_id = ?")
      .bind(tag.id)
      .first<{ count: number }>();
    expect(links?.count).toBe(0);
  });

  it("creates tags and rejects a repeated name", async () => {
    const owner = await ownerWithRestaurant();
    const created = await owner.client.post("/api/customer-tags", { name: "  Casa  ", color: "green" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ name: "Casa", color: "green" });

    const repeated = await owner.client.post("/api/customer-tags", { name: "casa", color: "blue" });
    expect(repeated.status).toBe(409);
    expect(await errorCode(repeated)).toBe("CUSTOMER_TAG_NAME_TAKEN");

    const tags = (await (await owner.client.get("/api/customer-tags")).json()) as CustomerTag[];
    expect(tags).toHaveLength(1);
  });
});

describe("delete customer", () => {
  it("anonymizes the orders but keeps their totals in Reports", async () => {
    const owner = await ownerWithRestaurant({ bindings: { ALLOW_PLAN_SWITCH: "true" } });
    expect((await owner.client.put("/api/restaurants/me/plan", { plan: "pro" })).status).toBe(200);
    const product = await createCatalog(owner);
    const seeded = await seedOrder(owner, product, { date: TODAY, quantity: 2 });
    const reportPath = `/api/reports/evolution?from=${TODAY}&to=${TODAY}`;
    const before = (await (await owner.client.get(reportPath)).json()) as { widgets: { billed: { currentCents: number } } };

    expect((await owner.client.delete(`/api/customers/${seeded.customerId}`)).status).toBe(204);
    const row = await env.DB.prepare("SELECT customer_id, customer_name, customer_phone, notes FROM orders WHERE id = ?")
      .bind(seeded.orderId)
      .first();
    expect(row).toEqual({ customer_id: null, customer_name: "Cliente eliminado", customer_phone: "", notes: null });

    const after = (await (await owner.client.get(reportPath)).json()) as { widgets: { billed: { currentCents: number } } };
    expect(after.widgets.billed.currentCents).toBe(before.widgets.billed.currentCents);

    expect((await owner.client.get(`/api/customers/${seeded.customerId}`)).status).toBe(404);
  });
});

describe("heatmap", () => {
  it("returns one point per customer with their latest address and counts the customers without one", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const withAddress = await seedOrder(owner, product, {});
    await seedOrder(owner, product, {});
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO customer_addresses (id, restaurant_id, customer_id, label, formatted_address, lat, lng, created_at, last_used_at)
         VALUES ('old', ?, ?, NULL, 'Vieja 1', -34.1, -58.1, ?, ?)`,
      ).bind(owner.restaurantId, withAddress.customerId, 1000, 1000),
      env.DB.prepare(
        `INSERT INTO customer_addresses (id, restaurant_id, customer_id, label, formatted_address, lat, lng, created_at, last_used_at)
         VALUES ('new', ?, ?, NULL, 'Nueva 2', -34.2, -58.2, ?, ?)`,
      ).bind(owner.restaurantId, withAddress.customerId, 2000, 2000),
    ]);

    const res = await owner.client.get("/api/customers/heatmap");
    expect(res.status).toBe(200);
    const map = (await res.json()) as CustomersHeatmap;
    expect(map.total).toBe(2);
    expect(map.withoutAddress).toBe(1);
    expect(map.points).toEqual([{ lat: -34.2, lng: -58.2, weight: 1 }]);
    expect(map.store).toBeNull();
  });
});

describe("import", () => {
  it("creates, updates without overwriting, reports errors and keeps the address as text without a Maps key", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    const existing = await seedOrder(owner, product, { name: "Juan", phone: "11 5555-1111" });
    await env.DB.prepare("UPDATE customers SET notes = 'No pisar', address = 'Calle vieja' WHERE id = ?")
      .bind(existing.customerId)
      .run();

    const res = await owner.client.post("/api/customers/import", {
      rows: [
        { row: 2, name: "Nuevo", phone: "11 5555-2222", address: "Calle nueva 123", notes: "", tags: ["Casa"] },
        { row: 3, name: "Juan", phone: "11 5555-1111", address: "Otra", notes: "Otra nota", tags: ["VIP"] },
        { row: 4, name: "", phone: "11 5555-3333", address: "", notes: "", tags: [] },
        { row: 5, name: "Extranjero", phone: "+1 555 123 4567", address: "", notes: "", tags: [] },
        { row: 6, name: "Malo", phone: "123", address: "", notes: "", tags: [] },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      created: 1,
      updated: 1,
      errors: [
        { row: 4, message: "Ingresá el nombre del cliente" },
        { row: 5, message: "Número extranjero" },
        { row: 6, message: "Teléfono inválido" },
      ],
    });

    const juan = await env.DB.prepare("SELECT notes, address FROM customers WHERE id = ?").bind(existing.customerId).first();
    expect(juan).toEqual({ notes: "No pisar", address: "Calle vieja" });

    const created = await env.DB.prepare("SELECT * FROM customers WHERE restaurant_id = ? AND phone = '5491155552222'")
      .bind(owner.restaurantId)
      .first<{ id: string; address: string }>();
    expect(created?.address).toBe("Calle nueva 123");
    const tags = await env.DB.prepare(
      `SELECT t.name, t.color FROM customer_tags t
        JOIN customer_tag_links l ON l.tag_id = t.id WHERE l.customer_id = ? ORDER BY t.name`,
    )
      .bind(created!.id)
      .all();
    expect(tags.results).toEqual([{ name: "Casa", color: "gray" }]);
    const vip = await env.DB.prepare(
      "SELECT count(*) AS count FROM customer_tag_links l JOIN customer_tags t ON t.id = l.tag_id WHERE l.customer_id = ? AND t.name = 'VIP'",
    )
      .bind(existing.customerId)
      .first<{ count: number }>();
    expect(vip?.count).toBe(1);
  });

  it("geocodes an imported address and stores it as a customer address", async () => {
    const owner = await ownerWithRestaurant();
    const client = await signedInClient(owner.email, owner.password, { GOOGLE_MAPS_SERVER_KEY: "test-key" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      json({
        status: "OK",
        results: [
          {
            place_id: "ChIJ-street",
            formatted_address: "Av. Corrientes 1234, CABA",
            types: ["street_address"],
            geometry: { location: { lat: -34.6, lng: -58.4 } },
            address_components: [{ long_name: "Buenos Aires", types: ["locality"] }],
          },
        ],
      }),
    );

    const res = await client.post("/api/customers/import", {
      rows: [{ row: 2, name: "Geo", phone: "11 5555-7777", address: "Corrientes 1234", notes: "", tags: [] }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, updated: 0, errors: [] });
    expect(String(spy.mock.calls[0]?.[0])).toContain("geocode/json");

    const address = await env.DB.prepare(
      "SELECT formatted_address, lat, lng FROM customer_addresses a JOIN customers c ON c.id = a.customer_id WHERE c.phone = '5491155557777'",
    ).first();
    expect(address).toEqual({ formatted_address: "Av. Corrientes 1234, CABA", lat: -34.6, lng: -58.4 });
  });
});

describe("export", () => {
  it("returns a CSV with the filters and every column of the model", async () => {
    const owner = await ownerWithRestaurant();
    const product = await createCatalog(owner);
    await seedOrder(owner, product, { name: "Ana", phone: "11 5555-1111" });
    await seedOrder(owner, product, { name: "Beto", phone: "11 5555-2222" });

    const res = await owner.client.get("/api/customers/export.csv?q=ana");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("Nombre;WhatsApp;Dirección;Pedidos;Gasto total;Ticket promedio;Primer pedido;Último pedido;Etiquetas;Notas;Acepta avisos");
    expect(csv).toContain("Ana");
    expect(csv).not.toContain("Beto");
  });
});

describe("permissions and tenant isolation", () => {
  it("guards each route with its own key", async () => {
    const owner = await ownerWithRestaurant();
    const viewer = await staffClient({ owner, permissions: ["customers.view"] });
    expect((await viewer.client.get("/api/customers")).status).toBe(200);
    expect((await viewer.client.get("/api/customers/export.csv")).status).toBe(403);
    expect((await viewer.client.post("/api/customers/import", { rows: [] })).status).toBe(403);

    const editor = await staffClient({ owner, permissions: ["customers.view", "customers.edit"] });
    expect((await editor.client.get("/api/customers/export.csv")).status).toBe(403);
    expect((await editor.client.post("/api/customer-tags", { name: "Casa", color: "gray" })).status).toBe(201);

    const deleter = await staffClient({ owner, permissions: ["customers.view"] });
    const product = await createCatalog(owner);
    const seeded = await seedOrder(owner, product, {});
    expect((await deleter.client.delete(`/api/customers/${seeded.customerId}`)).status).toBe(403);
  });

  it("does not leak a customer of another local", async () => {
    const a = await ownerWithRestaurant();
    const b = await ownerWithRestaurant();
    const product = await createCatalog(a);
    const seeded = await seedOrder(a, product, {});

    expect((await b.client.get(`/api/customers/${seeded.customerId}`)).status).toBe(404);
    expect((await b.client.patch(`/api/customers/${seeded.customerId}`, { name: "Hack" })).status).toBe(404);
    expect((await b.client.delete(`/api/customers/${seeded.customerId}`)).status).toBe(404);
  });
});
