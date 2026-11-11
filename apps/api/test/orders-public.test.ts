import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Category, Ingredient, Product, Restaurant } from "@menucito/shared";
import { Client, captureEmails } from "./helpers";

let sink: ReturnType<typeof captureEmails>;
beforeEach(() => {
  sink = captureEmails();
});
afterEach(() => sink.restore());

let counter = 0;
const unique = () => `${Date.now()}${counter++}`;
const sampleUuid = () =>
  "10000000-0000-4000-8000-" + String(counter++).padStart(12, "0");

/** A logged-in owner with a restaurant on the default (Basic) plan. */
async function owner(overrides: Record<string, unknown> = {}) {
  const email = `orders${unique()}@example.com`;
  await new Client().post("/api/auth/sign-up/email", {
    name: "Marta",
    email,
    password: "password-123",
    callbackURL: "/",
  });
  const client = new Client();
  await client.open(sink.last().link);
  expect(client.hasSession).toBe(true);
  const res = await client.post("/api/restaurants", {
    name: "Lo de Marta",
    slug: `menu-${unique()}`,
    whatsapp: "011 15 1234-5678",
    delivery: true,
    takeaway: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return { client, restaurant: (await res.json()) as Restaurant };
}

async function createCategory(client: Client, name: string) {
  const res = await client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return (await res.json()) as Category;
}

async function createProduct(
  client: Client,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await client.post("/api/products", {
    categoryId,
    name: "Hamburguesa completa",
    description: "Carne, queso y huevo",
    priceCents: 900_000,
    available: true,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Product;
}

const setPlan = (restaurantId: string, plan: "basic" | "pro") =>
  env.DB.prepare("UPDATE restaurants SET plan = ? WHERE id = ?").bind(plan, restaurantId).run();

async function putIngredients(client: Client, productId: string, ingredients: Ingredient[]) {
  const res = await client.request(`/api/products/${productId}/ingredients`, {
    method: "PUT",
    body: JSON.stringify({ ingredients }),
  });
  expect(res.status).toBe(200);
}

/** Internal id of the order with `number`: the public response never carries ids. */
async function orderIdByNumber(restaurantId: string, number: unknown): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM orders WHERE restaurant_id = ? AND number = ?")
    .bind(restaurantId, number)
    .first<{ id: string }>();
  expect(row).not.toBeNull();
  return row!.id;
}

/** Every object key in `value`, at any depth. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
  }
  return [];
}

const countRows = async (table: "orders" | "customers", restaurantId: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE restaurant_id = ?`)
    .bind(restaurantId)
    .first<{ n: number }>())!.n;

describe("POST /api/public/menus/:slug/orders (scenarios 14-30)", () => {
  it("creates a valid order and returns 201 with snapshot data (scenario 14)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    const clientOrderId = sampleUuid();
    const publicClient = new Client();
    const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 2 }],
      customer: {
        name: "Juan Perez",
        phone: "11 5555 1234",
        address: "Av. Corrientes 1234",
      },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 1_800_000,
      linePriceCents: 999_999, // Should be ignored
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: Record<string, unknown>; whatsappUrl: string; payment: unknown };
    expect(data.order.number).toBe(1);
    expect(data.order.customerName).toBe("Juan Perez");
    expect(data.order.customerPhone).toBe("5491155551234");
    expect(data.order.deliveryAddress).toBe("Av. Corrientes 1234");
    expect(data.order.subtotalCents).toBe(1_800_000);
    expect(data.order.shippingCents).toBe(0);
    expect(data.order.discountCents).toBe(0);
    expect(data.order.totalCents).toBe(1_800_000);

    const items = data.order.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Hamburguesa completa");
    expect(items[0]!.unitPriceCents).toBe(900_000);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.options).toBeNull();

    // Private fields should not be leaked in order: no ids and no internal state (scenario 14)
    const keys = keysDeep(data.order);
    for (const key of ["id", "orderId", "productId", "restaurantId", "ownerId", "plan", "status", "paymentStatus", "createdAt", "updatedAt"]) {
      expect(keys).not.toContain(key);
    }

    // Verify DB records
    const orderRows = await env.DB.prepare("SELECT * FROM orders WHERE client_token = ?").bind(clientOrderId).all();
    expect(orderRows.results).toHaveLength(1);
    const orderRow = orderRows.results[0] as Record<string, unknown>;
    expect(orderRow.number).toBe(1);
    expect(orderRow.promo_code_id).toBeNull();
    expect(orderRow.discount_cents).toBe(0);

    const customerRows = await env.DB.prepare("SELECT * FROM customers WHERE restaurant_id = ?").bind(restaurant.id).all();
    expect(customerRows.results).toHaveLength(1);
    const custRow = customerRows.results[0] as Record<string, unknown>;
    expect(custRow.phone).toBe("5491155551234");
    expect(orderRow.customer_id).toBe(custRow.id);

    const itemRows = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(orderRow.id).all();
    expect(itemRows.results).toHaveLength(1);
    const itemRow = itemRows.results[0] as Record<string, unknown>;
    expect(itemRow.position).toBe(0);
    expect(itemRow.name).toBe("Hamburguesa completa");
    expect(itemRow.unit_price_cents).toBe(900_000);
  });

  it("rejects expectedTotalCents mismatch with 409 PRICE_CHANGED and saves nothing (scenario 15)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    const clientOrderId = sampleUuid();
    const publicClient = new Client();
    const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 2 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 1_500_000, // Should be 1_800_000
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("PRICE_CHANGED");

    // Check nothing was written
    const orders = await env.DB.prepare("SELECT COUNT(*) as c FROM orders WHERE restaurant_id = ?").bind(restaurant.id).first<{ c: number }>();
    expect(orders?.c).toBe(0);
    const customers = await env.DB.prepare("SELECT COUNT(*) as c FROM customers WHERE restaurant_id = ?").bind(restaurant.id).first<{ c: number }>();
    expect(customers?.c).toBe(0);
  });

  it("calculates unit prices with ingredients on Pro plan and snapshots options_json (scenario 16)", async () => {
    const { client, restaurant } = await owner();
    await setPlan(restaurant.id, "pro");
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    const bacon: Ingredient = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };
    const onion: Ingredient = { name: "Cebolla", includedQty: 1, minQty: 0, maxQty: 2, extraPriceCents: 0 };
    await putIngredients(client, prod.id, [bacon, onion]);

    const clientOrderId = sampleUuid();
    const publicClient = new Client();
    // Unit price = 900_000 + (2 - 1) * 150_000 + (0 - 1)*0 = 1_050_000
    // Total for 2 units = 2 * 1_050_000 = 2_100_000
    const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{
        productId: prod.id,
        quantity: 2,
        choices: { Bacon: 2, Cebolla: 0 },
      }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 2_100_000,
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { order: Record<string, unknown> };
    const items = data.order.items as Array<Record<string, unknown>>;
    expect(items[0]!.unitPriceCents).toBe(1_050_000);
    expect(items[0]!.quantity).toBe(2);
    expect(data.order.subtotalCents).toBe(2_100_000);

    // Verify DB options_json snapshot
    const itemRow = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(await orderIdByNumber(restaurant.id, data.order.number)).first<Record<string, unknown>>();
    const parsedOptions = JSON.parse(itemRow?.options_json as string);
    expect(parsedOptions).toEqual([
      { name: "Bacon", quantity: 2, includedQty: 1, extraPriceCents: 150_000 },
      { name: "Cebolla", quantity: 0, includedQty: 1, extraPriceCents: 0 },
    ]);
  });

  it("validates choices strictly: 422 for invalid ingredients or on Basic plan (scenario 17)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    const publicClient = new Client();

    // 1. Basic plan rejects non-empty choices
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1, choices: { Bacon: 2 } }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 900_000,
    });
    expect(res1.status).toBe(422);

    // Switch to Pro
    await setPlan(restaurant.id, "pro");
    const bacon: Ingredient = { name: "Bacon", includedQty: 1, minQty: 0, maxQty: 3, extraPriceCents: 150_000 };
    await putIngredients(client, prod.id, [bacon]);

    // 2. Pro plan rejects non-existent ingredient
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1, choices: { Cheddar: 1 } }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 900_000,
    });
    expect(res2.status).toBe(422);

    // 3. Pro plan rejects qty > maxQty
    const res3 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1, choices: { Bacon: 5 } }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 900_000,
    });
    expect(res3.status).toBe(422);

    // 4. Choosing included quantity is valid and options_json is NULL
    const res4 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1, choices: { Bacon: 1 } }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 900_000,
    });
    expect(res4.status).toBe(201);
    const orderData = (await res4.json()) as { order: Record<string, unknown> };
    const itemRow = await env.DB.prepare("SELECT options_json FROM order_items WHERE order_id = ?").bind(await orderIdByNumber(restaurant.id, orderData.order.number)).first<Record<string, unknown>>();
    expect(itemRow?.options_json).toBeNull();
  });

  it("rejects unavailable, deleted or foreign products with 409 PRODUCT_UNAVAILABLE (scenario 18)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod1 = await createProduct(client, cat.id, { name: "Disponible", available: true, priceCents: 500_000 });
    const prod2 = await createProduct(client, cat.id, { name: "Agotado", available: false, priceCents: 600_000 });

    const publicClient = new Client();

    // 1. Unavailable product
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod2.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 600_000,
    });
    expect(res1.status).toBe(409);
    const json1 = (await res1.json()) as { error: { code: string; message: string } };
    expect(json1.error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(json1.error.message).toContain("Agotado");

    // 2. Mix of valid and unavailable products saves nothing
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [
        { productId: prod1.id, quantity: 1 },
        { productId: prod2.id, quantity: 1 },
      ],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 1_100_000,
    });
    expect(res2.status).toBe(409);
    const count = await env.DB.prepare("SELECT COUNT(*) as c FROM orders WHERE restaurant_id = ?").bind(restaurant.id).first<{ c: number }>();
    expect(count?.c).toBe(0);

    // 3. Foreign product
    const otherOwner = await owner();
    const otherCat = await createCategory(otherOwner.client, "Pizzas");
    const foreignProd = await createProduct(otherOwner.client, otherCat.id, { name: "Pizza Muzza", priceCents: 800_000 });

    const res3 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: foreignProd.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 800_000,
    });
    expect(res3.status).toBe(409);
    expect(((await res3.json()) as { error: { code: string } }).error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("handles price change during ordering: 409 then 201 when retrying with new total (scenario 19)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    // Owner raises price
    await client.request(`/api/products/${prod.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priceCents: 1_100_000 }),
    });

    const publicClient = new Client();
    const clientOrderId = sampleUuid();

    // Client sends old expected total (900_000)
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 900_000,
    });
    expect(res1.status).toBe(409);
    expect(((await res1.json()) as { error: { code: string } }).error.code).toBe("PRICE_CHANGED");

    // Client reconciles and resends with new expected total (1_100_000)
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 1_100_000,
    });
    expect(res2.status).toBe(201);
  });

  it("preserves order snapshot when product is edited or deleted (scenario 20)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { name: "Burger Original", priceCents: 900_000 });

    const publicClient = new Client();
    const clientOrderId = sampleUuid();
    const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId,
      expectedTotalCents: 900_000,
    });
    expect(res.status).toBe(201);
    const orderData = (await res.json()) as { order: Record<string, unknown> };

    // Delete product from catalog
    const delRes = await client.request(`/api/products/${prod.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // Order item still exists, product_id is set to NULL, name and unit_price are preserved
    const itemRow = await env.DB.prepare("SELECT * FROM order_items WHERE order_id = ?").bind(await orderIdByNumber(restaurant.id, orderData.order.number)).first<Record<string, unknown>>();
    expect(itemRow?.name).toBe("Burger Original");
    expect(itemRow?.unit_price_cents).toBe(900_000);
    expect(itemRow?.product_id).toBeNull();
  });

  it("enforces store configuration rules in order without saving (scenario 21)", async () => {
    const { client, restaurant } = await owner({ delivery: false, takeaway: true });
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    // Set minOrderCents = 1_000_000
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 1_000_000 }),
    });

    const publicClient = new Client();

    // 1. Paused store -> 409 STORE_PAUSED
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: false }),
    });
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res1.status).toBe(409);
    expect(((await res1.json()) as { error: { code: string } }).error.code).toBe("STORE_PAUSED");

    // Unpause
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: true }),
    });

    // 2. Fulfillment not offered -> 409 FULFILLMENT_NOT_OFFERED (restaurant only offers takeaway)
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res2.status).toBe(409);
    expect(((await res2.json()) as { error: { code: string } }).error.code).toBe("FULFILLMENT_NOT_OFFERED");

    // 3. Payment method not accepted -> 409 PAYMENT_METHOD_NOT_ACCEPTED (transfer disabled by default for new restaurant)
    const res3 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "transfer",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res3.status).toBe(409);
    expect(((await res3.json()) as { error: { code: string } }).error.code).toBe("PAYMENT_METHOD_NOT_ACCEPTED");

    // 4. Below minimum -> 409 BELOW_MINIMUM (subtotal 500_000 < min 1_000_000)
    const res4 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res4.status).toBe(409);
    expect(((await res4.json()) as { error: { code: string } }).error.code).toBe("BELOW_MINIMUM");

    // Subtotal == minOrderCents is accepted!
    const res5 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 2 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 1_000_000,
    });
    expect(res5.status).toBe(201);
  });

  it("calculates shipping correctly and isolates from future changes (scenario 22)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });

    // Set shipping to 100_000 ($1.000)
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ shippingCents: 100_000 }),
    });

    const publicClient = new Client();

    // 1. Delivery includes shipping
    const resDel = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 1_000_000, // 900_000 + 100_000
    });
    expect(resDel.status).toBe(201);
    const orderDel = (await resDel.json()) as { order: Record<string, unknown> };
    expect(orderDel.order.subtotalCents).toBe(900_000);
    expect(orderDel.order.shippingCents).toBe(100_000);
    expect(orderDel.order.totalCents).toBe(1_000_000);

    // 2. Takeaway has shipping 0
    const resTak = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 900_000, // 900_000 + 0
    });
    expect(resTak.status).toBe(201);
    const orderTak = (await resTak.json()) as { order: Record<string, unknown> };
    expect(orderTak.order.subtotalCents).toBe(900_000);
    expect(orderTak.order.shippingCents).toBe(0);
    expect(orderTak.order.totalCents).toBe(900_000);

    // 3. Changing shipping later does not affect saved orders
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ shippingCents: 200_000 }),
    });
    const savedOrder = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(await orderIdByNumber(restaurant.id, orderDel.order.number)).first<Record<string, unknown>>();
    expect(savedOrder?.shipping_cents).toBe(100_000);
    expect(savedOrder?.total_cents).toBe(1_000_000);
  });

  it("deduplicates customers by phone per restaurant and snapshots customer data (scenario 23)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    const publicClient = new Client();

    // Order 1: Juan with phone 11 5555-1234
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan Perez", phone: "11 5555-1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res1.status).toBe(201);
    const order1 = ((await res1.json()) as { order: Record<string, unknown> }).order;

    // Order 2: same phone formatted differently "+54 9 11 5555 1234" but different name and address
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Pedro Gomez", phone: "+54 9 11 5555 1234", address: "Calle 2" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res2.status).toBe(201);
    const order2 = ((await res2.json()) as { order: Record<string, unknown> }).order;

    // Both orders link to the SAME customer in customers table
    const customers = await env.DB.prepare("SELECT * FROM customers WHERE restaurant_id = ?").bind(restaurant.id).all();
    expect(customers.results).toHaveLength(1);
    const cust = customers.results[0] as Record<string, unknown>;
    expect(cust.name).toBe("Pedro Gomez"); // The last name wins (change 17a)
    expect(cust.address).toBeNull(); // Addresses live in `customer_addresses`

    const orderRow1 = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(await orderIdByNumber(restaurant.id, order1.number)).first<Record<string, unknown>>();
    const orderRow2 = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(await orderIdByNumber(restaurant.id, order2.number)).first<Record<string, unknown>>();
    expect(orderRow1?.customer_id).toBe(cust.id);
    expect(orderRow2?.customer_id).toBe(cust.id);

    // Each order keeps its own snapshot
    expect(orderRow1?.customer_name).toBe("Juan Perez");
    expect(orderRow1?.delivery_address).toBe("Calle 1");
    expect(orderRow2?.customer_name).toBe("Pedro Gomez");
    expect(orderRow2?.delivery_address).toBe("Calle 2");

    // Same phone in another restaurant creates a separate customer row
    const otherOwner = await owner();
    const otherCat = await createCategory(otherOwner.client, "Pizzas");
    const otherProd = await createProduct(otherOwner.client, otherCat.id, { priceCents: 500_000 });

    const resOther = await publicClient.post(`/api/public/menus/${otherOwner.restaurant.slug}/orders`, {
      items: [{ productId: otherProd.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(resOther.status).toBe(201);
    const otherCustomers = await env.DB.prepare("SELECT * FROM customers WHERE restaurant_id = ?").bind(otherOwner.restaurant.id).all();
    expect(otherCustomers.results).toHaveLength(1);
    expect(otherCustomers.results[0]?.id).not.toBe(cust.id);
  });

  it("gives the WhatsApp permission to every customer that orders from the web menu", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    const res = await new Client().post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Web", phone: "11 5555-3333", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res.status).toBe(201);

    const customer = await env.DB.prepare(
      "SELECT whatsapp_opt_in_at, whatsapp_opt_in_source FROM customers WHERE restaurant_id = ? AND phone = '5491155553333'",
    )
      .bind(restaurant.id)
      .first<{ whatsapp_opt_in_at: number | null; whatsapp_opt_in_source: string | null }>();
    expect(customer?.whatsapp_opt_in_at).not.toBeNull();
    expect(customer?.whatsapp_opt_in_source).toBe("web");
  });

  it("assigns sequential correlative numbers starting from 1 (scenario 24)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 100_000 });

    const publicClient = new Client();

    // Create 3 orders sequentially
    for (let i = 1; i <= 3; i++) {
      const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
        items: [{ productId: prod.id, quantity: 1 }],
        customer: { name: `Customer ${i}`, phone: `11 5555 120${i}`, address: "Calle 1" },
        fulfillment: "delivery",
        paymentMethod: "cash",
        clientOrderId: sampleUuid(),
        expectedTotalCents: 100_000,
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as { order: { number: number } };
      expect(data.order.number).toBe(i);
    }

    // Rejected order does not consume a number
    const resFail = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Customer X", phone: "11 5555 1299", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 999_999, // Mismatch
    });
    expect(resFail.status).toBe(409);

    // Next successful order gets number 4
    const resNext = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Customer 4", phone: "11 5555 1204", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(resNext.status).toBe(201);
    const dataNext = (await resNext.json()) as { order: { number: number } };
    expect(dataNext.order.number).toBe(4);
  });

  it("handles idempotency via clientOrderId: resending returns 200 with same order (scenario 25)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    const publicClient = new Client();
    const clientOrderId = sampleUuid();

    const payload = {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery" as const,
      paymentMethod: "cash" as const,
      clientOrderId,
      expectedTotalCents: 500_000,
    };

    // First attempt -> 201
    const res1 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, payload);
    expect(res1.status).toBe(201);
    const data1 = (await res1.json()) as { order: Record<string, unknown>; whatsappUrl: string };

    // Pause store afterwards
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: false }),
    });

    // Resend identical clientOrderId -> 200 (not 201, not 409 STORE_PAUSED)
    const res2 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, payload);
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { order: Record<string, unknown>; whatsappUrl: string };

    expect(data2.order).toEqual(data1.order);
    expect(data2.order.number).toBe(data1.order.number);
    expect(data2.whatsappUrl).toBe(data1.whatsappUrl);

    // Only one order in database
    const orders = await env.DB.prepare("SELECT * FROM orders WHERE restaurant_id = ?").bind(restaurant.id).all();
    expect(orders.results).toHaveLength(1);
  });

  it("enforces validation limits and 16KB body limit (scenario 26)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 100_000 });

    const publicClient = new Client();

    // 1. More than 30 lines -> 422
    const items31 = Array.from({ length: 31 }, () => ({ productId: prod.id, quantity: 1 }));
    const resLines = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: items31,
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 3_100_000,
    });
    expect(resLines.status).toBe(422);

    // 2. Quantity 0 or 21 -> 422
    const resQty0 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 0 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 0,
    });
    expect(resQty0.status).toBe(422);

    const resQty21 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 21 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 2_100_000,
    });
    expect(resQty21.status).toBe(422);

    // 3. Name > 60 chars -> 422
    const resName = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "A".repeat(61), phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(resName.status).toBe(422);

    // 4. Address > 120 chars -> 422
    const resAddr = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "B".repeat(121) },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(resAddr.status).toBe(422);

    // 5. Invalid token -> 422
    const resToken = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: "not-a-uuid",
      expectedTotalCents: 100_000,
    });
    expect(resToken.status).toBe(422);

    // 6. Non-JSON body -> 422
    const resNotJson = await publicClient.request(`/api/public/menus/${restaurant.slug}/orders`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    expect(resNotJson.status).toBe(422);

    // 7. Body > 16 KB -> 413
    const bigString = "x".repeat(17 * 1024);
    const resBig = await publicClient.request(`/api/public/menus/${restaurant.slug}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: bigString }),
    });
    expect(resBig.status).toBe(413);
    expect(((await resBig.json()) as { error: { code: string } }).error.code).toBe("BODY_TOO_LARGE");
  });

  it("throttles orders by phone: 3 per 10m allowed, 4th gives 429 TOO_MANY_ORDERS (scenario 27)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 100_000 });

    const publicClient = new Client();
    const phone = "11 5555 9999";

    // 3 orders allowed
    for (let i = 0; i < 3; i++) {
      const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
        items: [{ productId: prod.id, quantity: 1 }],
        customer: { name: "Juan", phone, address: "Calle 1" },
        fulfillment: "delivery",
        paymentMethod: "cash",
        clientOrderId: sampleUuid(),
        expectedTotalCents: 100_000,
      });
      expect(res.status).toBe(201);
    }

    // 4th order with same phone rejected -> 429
    const res4 = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone, address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(res4.status).toBe(429);
    expect(((await res4.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_ORDERS");

    // Another phone is NOT blocked
    const resOtherPhone = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Maria", phone: "11 5555 8888", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(resOtherPhone.status).toBe(201);

    // Aging out one order allows another
    const firstOrder = await env.DB.prepare("SELECT id FROM orders WHERE customer_phone = '5491155559999' ORDER BY created_at ASC LIMIT 1").first<{ id: string }>();
    expect(firstOrder?.id).toBeDefined();
    await env.DB.prepare("UPDATE orders SET created_at = ? WHERE id = ?").bind(Date.now() - 15 * 60 * 1000, firstOrder!.id).run();

    const resRetry = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone, address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(resRetry.status).toBe(201);
  });

  it("returns 404 RESTAURANT_NOT_FOUND for invalid, reserved or nonexistent slug (scenario 28)", async () => {
    const publicClient = new Client();

    // Invalid slug format
    const resInvalid = await publicClient.post("/api/public/menus/INVALID_SLUG!/orders", {
      items: [{ productId: "p1", quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100,
    });
    expect(resInvalid.status).toBe(404);

    // Reserved slug
    const resReserved = await publicClient.post("/api/public/menus/admin/orders", {
      items: [{ productId: "p1", quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100,
    });
    expect(resReserved.status).toBe(404);

    // Nonexistent slug
    const resMissing = await publicClient.post("/api/public/menus/nonexistent-slug-xyz/orders", {
      items: [{ productId: "p1", quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100,
    });
    expect(resMissing.status).toBe(404);
  });

  it("formats WhatsApp URL and returns transfer details when transfer is selected (scenario 29)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    // Enable transfer with alias and holder
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({
        paymentMethods: [
          { method: "cash", enabled: true },
          { method: "transfer", enabled: true, alias: "marta.burgers", holderName: "Marta Gomez" },
        ],
      }),
    });

    const publicClient = new Client();
    const res = await publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan Perez", phone: "11 5555 1234", address: "Av. Corrientes 123" },
      fulfillment: "delivery",
      paymentMethod: "transfer",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      order: Record<string, unknown>;
      whatsappUrl: string;
      payment: { alias: string; holderName: string } | null;
    };

    expect(data.payment).toEqual({ alias: "marta.burgers", holderName: "Marta Gomez" });
    expect(data.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5491112345678\?text=/);
    expect(data.whatsappUrl).toContain(encodeURIComponent("pedido #1"));
    expect(data.whatsappUrl).toContain(encodeURIComponent("marta.burgers"));
    expect(data.whatsappUrl).toContain(encodeURIComponent("Marta Gomez"));
  });

  it("handles CORS: 204 OPTIONS for origins in WEB_ORIGINS, no CORS headers for others (scenario 30)", async () => {
    const webOrigin = "http://localhost:4321";
    // Client with WEB_ORIGINS bound
    const publicClient = new Client({ WEB_ORIGINS: `${webOrigin}, https://menucito.ar` });

    // 1. Allowed origin OPTIONS
    const resAllowed = await publicClient.request("/api/public/menus/test-slug", {
      method: "OPTIONS",
      headers: {
        Origin: webOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    expect(resAllowed.status).toBe(204);
    expect(resAllowed.headers.get("Access-Control-Allow-Origin")).toBe(webOrigin);
    expect(resAllowed.headers.get("Access-Control-Allow-Methods")).toContain("POST");

    // 2. Disallowed origin OPTIONS
    const resDisallowed = await publicClient.request("/api/public/menus/test-slug", {
      method: "OPTIONS",
      headers: {
        Origin: "http://malicious-site.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(resDisallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();

    // 3. Client without WEB_ORIGINS
    const clientNoCors = new Client({ WEB_ORIGINS: "" });
    const resNoOrigins = await clientNoCors.request("/api/public/menus/test-slug", {
      method: "OPTIONS",
      headers: { Origin: webOrigin },
    });
    expect(resNoOrigins.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("store rules order, numbering and idempotency under concurrency (scenarios 21, 24, 25)", () => {
  const errorCodeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  it("checks the pause before the minimum and saves nothing after each 409 (scenario 21)", async () => {
    const { client, restaurant } = await owner({ delivery: false, takeaway: true });
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });
    const settingsRes = await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: false, minOrderCents: 1_000_000 }),
    });
    expect(settingsRes.status).toBe(200);

    const publicClient = new Client();
    const order = (overrides: Record<string, unknown>) =>
      publicClient.post(`/api/public/menus/${restaurant.slug}/orders`, {
        items: [{ productId: prod.id, quantity: 1 }],
        customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
        fulfillment: "takeaway",
        paymentMethod: "cash",
        clientOrderId: sampleUuid(),
        expectedTotalCents: 500_000,
        ...overrides,
      });

    // Paused and below the minimum at once: the pause is reported first
    const paused = await order({});
    expect(paused.status).toBe(409);
    expect(await errorCodeOf(paused)).toBe("STORE_PAUSED");

    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ acceptingOrders: true }),
    });

    const rejected: Array<[Record<string, unknown>, string]> = [
      [{ fulfillment: "delivery" }, "FULFILLMENT_NOT_OFFERED"],
      [{ paymentMethod: "transfer" }, "PAYMENT_METHOD_NOT_ACCEPTED"],
      [{}, "BELOW_MINIMUM"],
      [{ items: [{ productId: prod.id, quantity: 2 }], expectedTotalCents: 1 }, "PRICE_CHANGED"],
    ];
    for (const [overrides, code] of rejected) {
      const res = await order(overrides);
      expect(res.status).toBe(409);
      expect(await errorCodeOf(res)).toBe(code);
    }

    expect(await countRows("orders", restaurant.id)).toBe(0);
    expect(await countRows("customers", restaurant.id)).toBe(0);
  });

  it("compares the minimum against the subtotal, not the total with shipping (scenario 21)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 900_000 });
    await client.request("/api/restaurants/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ minOrderCents: 1_000_000, shippingCents: 200_000 }),
    });

    // subtotal 900_000 < minimum 1_000_000 <= total 1_100_000
    const res = await new Client().post(`/api/public/menus/${restaurant.slug}/orders`, {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 1_100_000,
    });
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("BELOW_MINIMUM");
    expect(await countRows("orders", restaurant.id)).toBe(0);
  });

  it("numbers 10 simultaneous orders 1 to 10, and another restaurant from 1 (scenario 24)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 100_000 });

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        new Client().post(`/api/public/menus/${restaurant.slug}/orders`, {
          items: [{ productId: prod.id, quantity: 1 }],
          customer: { name: `Customer ${i}`, phone: `11 5555 13${String(i).padStart(2, "0")}`, address: "Calle 1" },
          fulfillment: "delivery",
          paymentMethod: "cash",
          clientOrderId: sampleUuid(),
          expectedTotalCents: 100_000,
        }),
      ),
    );
    const numbers: number[] = [];
    for (const res of responses) {
      expect(res.status).toBe(201);
      numbers.push(((await res.json()) as { order: { number: number } }).order.number);
    }
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const other = await owner();
    const otherCat = await createCategory(other.client, "Pizzas");
    const otherProd = await createProduct(other.client, otherCat.id, { priceCents: 100_000 });
    const otherRes = await new Client().post(`/api/public/menus/${other.restaurant.slug}/orders`, {
      items: [{ productId: otherProd.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 100_000,
    });
    expect(otherRes.status).toBe(201);
    expect(((await otherRes.json()) as { order: { number: number } }).order.number).toBe(1);
  });

  it("creates one order when the same token arrives twice at once: one 201 and one 200 (scenario 25)", async () => {
    const { client, restaurant } = await owner();
    const cat = await createCategory(client, "Burgers");
    const prod = await createProduct(client, cat.id, { priceCents: 500_000 });

    const payload = {
      items: [{ productId: prod.id, quantity: 1 }],
      customer: { name: "Juan", phone: "11 5555 1234", address: "Calle 1" },
      fulfillment: "delivery",
      paymentMethod: "cash",
      clientOrderId: sampleUuid(),
      expectedTotalCents: 500_000,
    };
    const [first, second] = await Promise.all([
      new Client().post(`/api/public/menus/${restaurant.slug}/orders`, payload),
      new Client().post(`/api/public/menus/${restaurant.slug}/orders`, payload),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const [a, b] = (await Promise.all([first.json(), second.json()])) as Array<{
      order: { number: number };
      whatsappUrl: string;
    }>;
    expect(a!.order.number).toBe(b!.order.number);
    expect(a!.whatsappUrl).toBe(b!.whatsappUrl);
    expect(await countRows("orders", restaurant.id)).toBe(1);
  });
});
