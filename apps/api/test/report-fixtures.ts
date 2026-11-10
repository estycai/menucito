import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { localDayRange } from "@menucito/shared";
import { Client, ownerWithRestaurant, type OwnerFixture } from "./helpers";

/** Shared fixtures of the report tests (changes 16a and 16b): a Pro store, its menu and seeded sales. */

const PRICE = 100_000;
let counter = 0;
const uuid = () => "50000000-0000-4000-8000-" + String(counter++).padStart(12, "0");
const nextPhone = () => `11 7777 ${String(1000 + counter++).slice(-4)}`;

export interface Store extends OwnerFixture {
  productId: string;
  categoryId: string;
}

export async function proStore(): Promise<Store> {
  const owner = await ownerWithRestaurant();
  await env.DB.prepare("UPDATE restaurants SET plan = 'pro' WHERE id = ?").bind(owner.restaurantId).run();
  const category = (await (await owner.client.post("/api/categories", { name: "Burgers" })).json()) as { id: string };
  const product = (await (
    await owner.client.post("/api/products", { categoryId: category.id, name: "Burger", priceCents: PRICE })
  ).json()) as { id: string };
  const settings = await owner.client.patch("/api/restaurants/me/settings", {
    acceptOrdersOutsideHours: true,
    paymentMethods: [
      { method: "cash", enabled: true },
      { method: "transfer", enabled: true, alias: "marta.pay", holderName: "Marta" },
      { method: "split", enabled: true },
    ],
  });
  expect(settings.status).toBe(200);
  return { ...owner, productId: product.id, categoryId: category.id };
}

export async function addCategory(store: Store, name: string): Promise<string> {
  const res = await store.client.post("/api/categories", { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

export interface IngredientFixture {
  name: string;
  includedQty: number;
  minQty: number;
  maxQty: number;
  extraPriceCents: number;
}

export async function addProduct(
  store: Store,
  name: string,
  options: { priceCents?: number; categoryId?: string; ingredients?: IngredientFixture[] } = {},
): Promise<string> {
  const categoryId = options.categoryId ?? (await addCategory(store, `Cat ${uuid()}`));
  const res = await store.client.post("/api/products", {
    categoryId,
    name,
    priceCents: options.priceCents ?? PRICE,
  });
  expect(res.status).toBe(201);
  const product = (await res.json()) as { id: string };
  if (options.ingredients) {
    const ingredients = await store.client.put(`/api/products/${product.id}/ingredients`, {
      ingredients: options.ingredients,
    });
    expect(ingredients.status).toBe(200);
  }
  return product.id;
}

export interface SeedOptions {
  quantity?: number;
  fulfillment?: "delivery" | "takeaway";
  paymentMethod?: "cash" | "transfer" | "split";
  splitCashCents?: number;
  shippingCents?: number;
  tipCents?: number;
  discountCents?: number;
  totalCents?: number;
  status?: string;
  paymentStatus?: string;
  /** `YYYY-MM-DD` in Argentina and `HH:MM`; defaults to now. */
  date?: string;
  time?: string;
  source?: string;
  courierMemberId?: string | null;
  phone?: string;
  customerName?: string;
  productId?: string;
  choices?: Record<string, number>;
}

/** Creates an order through the public menu and then stamps it as the report test needs. */
export async function seed(store: Store, options: SeedOptions = {}) {
  const quantity = options.quantity ?? 1;
  const fulfillment = options.fulfillment ?? "delivery";
  const paymentMethod = options.paymentMethod ?? "cash";
  const shipping = fulfillment === "delivery" ? (options.shippingCents ?? 0) : 0;
  const tip = options.tipCents ?? 0;
  const productId = options.productId ?? store.productId;
  const product = await env.DB.prepare("SELECT price_cents AS priceCents FROM products WHERE id = ?")
    .bind(productId)
    .first<{ priceCents: number }>();
  // The public menu prices the extras into the unit price; this is the total it will validate.
  const ingredients = await env.DB.prepare(
    "SELECT name, included_qty AS includedQty, extra_price_cents AS extraPriceCents FROM ingredients WHERE product_id = ?",
  )
    .bind(productId)
    .all<{ name: string; includedQty: number; extraPriceCents: number }>();
  const extrasPerUnit = ingredients.results.reduce((sum, ingredient) => {
    const chosen = options.choices?.[ingredient.name];
    return sum + (chosen === undefined ? 0 : Math.max(0, chosen - ingredient.includedQty) * ingredient.extraPriceCents);
  }, 0);
  const subtotal = ((product?.priceCents ?? PRICE) + extrasPerUnit) * quantity;
  const token = uuid();
  const res = await new Client().post(`/api/public/menus/${store.slug}/orders`, {
    items: [{ productId, quantity, ...(options.choices ? { choices: options.choices } : {}) }],
    customer: {
      name: options.customerName ?? "Ana",
      phone: options.phone ?? nextPhone(),
      address: fulfillment === "delivery" ? "Calle 1" : null,
    },
    fulfillment,
    paymentMethod,
    clientOrderId: token,
    ...(paymentMethod === "split" ? { splitCashCents: options.splitCashCents ?? Math.floor(subtotal / 2) } : {}),
    ...(tip > 0 ? { tipCents: tip } : {}),
    expectedTotalCents: subtotal + tip,
  });
  expect(res.status).toBe(201);

  const createdAt = options.date
    ? localDayRange(options.date)[0] + timeMinutes(options.time ?? "12:00") * 60_000
    : Date.now();
  const rowTotal = options.totalCents ?? subtotal + shipping + tip - (options.discountCents ?? 0);
  await env.DB.prepare(
    `UPDATE orders
        SET status = ?, payment_status = ?, source = ?, courier_member_id = ?,
            created_at = ?, updated_at = ?, discount_cents = ?, shipping_cents = ?, tip_cents = ?, total_cents = ?
      WHERE client_token = ?`,
  )
    .bind(
      options.status ?? "delivered",
      options.paymentStatus ?? "paid",
      options.source ?? "web",
      options.courierMemberId ?? null,
      createdAt,
      createdAt,
      options.discountCents ?? 0,
      shipping,
      tip,
      rowTotal,
      token,
    )
    .run();
  const row = await env.DB.prepare("SELECT id FROM orders WHERE client_token = ?").bind(token).first<{ id: string }>();
  await env.DB.prepare(
    `UPDATE customers SET first_order_at = ?
      WHERE id = (SELECT customer_id FROM orders WHERE client_token = ?)
        AND (first_order_at IS NULL OR first_order_at > ?)`,
  )
    .bind(createdAt, token, createdAt)
    .run();
  return { id: row!.id, totalCents: rowTotal };
}

function timeMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  return params.toString();
}

export async function report<T>(client: Client, path: string, values: Record<string, string | undefined>): Promise<T> {
  const res = await client.get(`/api/reports/${path}?${queryString(values)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

export const RANGE = { from: "2026-06-01", to: "2026-06-30" };
