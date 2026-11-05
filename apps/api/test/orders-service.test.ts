import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type CreateOrderRequest, type HoursSlot, type OrderDetail } from "@menucito/shared";
import type { ProductRow, RestaurantRow } from "../src/db/schema";
import type { AppEnv } from "../src/env";
import type { DeliveryRepository } from "../src/repositories/delivery";
import type { HoursRepository } from "../src/repositories/hours";
import { UniqueViolationError } from "../src/repositories/errors";
import type { IngredientsRepository } from "../src/repositories/ingredients";
import type { OrdersRepository } from "../src/repositories/orders";
import type { ProductsRepository } from "../src/repositories/products";
import type { RestaurantsRepository } from "../src/repositories/restaurants";
import type { SettingsRepository } from "../src/repositories/settings";
import { domainErrorHandler } from "../src/routes/http";
import { createPublicOrdersService } from "../src/services/orders";

const restaurant = {
  id: "rest-1",
  name: "Lo de Marta",
  slug: "lo-de-marta",
  whatsapp: "5491112345678",
  delivery: true,
  takeaway: true,
  plan: "basic",
} as RestaurantRow;

const product = { id: "prod-1", name: "Burger", priceCents: 100_000, available: true } as ProductRow;

const request: CreateOrderRequest = {
  items: [{ productId: product.id, quantity: 1, choices: {} }],
  customer: { name: "Juan", phone: "5491155551234", address: null },
  fulfillment: "takeaway",
  paymentMethod: "cash",
  clientOrderId: "8f2c7a64-4f7e-4b55-9d3c-1a2b3c4d5e6f",
  expectedTotalCents: 100_000,
  tipCents: 0,
  delivery: null,
};

const storedOrder: OrderDetail = {
  id: "order-1",
  number: 7,
  status: "new",
  paymentStatus: "pending",
  fulfillment: "takeaway",
  paymentMethod: "cash",
  customerName: "Juan",
  customerPhone: "5491155551234",
  deliveryAddress: null,
  deliveryLocation: null,
  notes: null,
  subtotalCents: 100_000,
  shippingCents: 0,
  discountCents: 0,
  tipCents: 0,
  totalCents: 100_000,
  items: [],
  createdAt: 0,
  updatedAt: 0,
  courier: null,
  sentAt: null,
  deliveredAt: null,
};

const numberCollision = () => new UniqueViolationError("restaurant_id", "orders", ["restaurant_id", "number"]);
const tokenCollision = () => new UniqueViolationError("restaurant_id", "orders", ["restaurant_id", "client_token"]);

interface HoursOptions {
  slots?: HoursSlot[];
  acceptOrdersOutsideHours?: boolean;
  now?: Date;
}

/** Service over in-memory fakes; `insertOrder` plays the given outcomes in order. */
function serviceWith(outcomes: Array<OrderDetail | Error>, raced: OrderDetail | null = null, hours: HoursOptions = {}) {
  let lookups = 0;
  const insertOrder = vi.fn(async () => {
    const outcome = outcomes.shift();
    if (!outcome) throw new Error("no more outcomes");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const orders = {
    // The first lookup is the idempotency check before inserting; later ones see the raced order.
    findByToken: async () => (lookups++ === 0 ? null : raced),
    countRecentByPhone: async () => 0,
    insertOrder,
  } as unknown as OrdersRepository;
  const service = createPublicOrdersService({
    restaurants: { findBySlug: async () => restaurant } as unknown as RestaurantsRepository,
    settings: {
      findSettings: async () => ({ ...DEFAULT_SETTINGS, acceptOrdersOutsideHours: hours.acceptOrdersOutsideHours ?? false }),
    } as unknown as SettingsRepository,
    orders,
    products: { list: async () => [product] } as unknown as ProductsRepository,
    ingredients: { listByRestaurant: async () => [] } as unknown as IngredientsRepository,
    delivery: { findLocation: async () => null, listZones: async () => [] } as unknown as DeliveryRepository,
    hours: { listSlots: async () => hours.slots ?? [] } as unknown as HoursRepository,
    ...(hours.now ? { now: () => hours.now! } : {}),
  });
  return { service, insertOrder };
}

describe("createOrder insert retries (no database)", () => {
  it("retries a number collision and creates the order", async () => {
    const { service, insertOrder } = serviceWith([numberCollision(), storedOrder]);
    const result = await service.createOrder(restaurant.slug, request);
    expect(result.status).toBe(201);
    expect(result.response.order.number).toBe(7);
    expect(insertOrder).toHaveBeenCalledTimes(2);
  });

  it("answers ORDER_NUMBER_CONFLICT after 3 number collisions", async () => {
    const { service, insertOrder } = serviceWith([numberCollision(), numberCollision(), numberCollision()]);
    await expect(service.createOrder(restaurant.slug, request)).rejects.toMatchObject({ code: "ORDER_NUMBER_CONFLICT" });
    expect(insertOrder).toHaveBeenCalledTimes(3);
  });

  it("returns the concurrent order as resent (200) on a token collision", async () => {
    const { service, insertOrder } = serviceWith([tokenCollision()], storedOrder);
    const result = await service.createOrder(restaurant.slug, request);
    expect(result.status).toBe(200);
    expect(result.response.order.number).toBe(7);
    expect(insertOrder).toHaveBeenCalledTimes(1);
  });

  it("rethrows any other error at once, without retrying", async () => {
    const failure = new Error("D1_ERROR: disk I/O error");
    const { service, insertOrder } = serviceWith([failure, storedOrder]);
    await expect(service.createOrder(restaurant.slug, request)).rejects.toBe(failure);
    expect(insertOrder).toHaveBeenCalledTimes(1);
  });

  it("rethrows a UNIQUE violation on an unexpected column", async () => {
    const failure = new UniqueViolationError("id", "orders");
    const { service, insertOrder } = serviceWith([failure, storedOrder]);
    await expect(service.createOrder(restaurant.slug, request)).rejects.toBe(failure);
    expect(insertOrder).toHaveBeenCalledTimes(1);
  });
});

describe("createOrder opening hours (no database)", () => {
  // 2026-11-02 is a Monday; Argentina is UTC-3.
  const at = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
  const dinner: HoursSlot = { weekday: 1, opensAt: 19 * 60, closesAt: 60, fulfillment: "all" };

  it("takes the order while open", async () => {
    const { service } = serviceWith([storedOrder], null, { slots: [dinner], now: at("2026-11-02T20:00:00") });
    expect((await service.createOrder(restaurant.slug, request)).status).toBe(201);
  });

  it("refuses with STORE_CLOSED while closed when the store does not take orders outside its hours", async () => {
    const { service, insertOrder } = serviceWith([storedOrder], null, { slots: [dinner], now: at("2026-11-02T12:00:00") });
    await expect(service.createOrder(restaurant.slug, request)).rejects.toMatchObject({ code: "STORE_CLOSED" });
    expect(insertOrder).not.toHaveBeenCalled();
  });

  it("takes the order while closed when the store accepts orders outside its hours", async () => {
    const { service } = serviceWith([storedOrder], null, {
      slots: [dinner],
      acceptOrdersOutsideHours: true,
      now: at("2026-11-02T12:00:00"),
    });
    expect((await service.createOrder(restaurant.slug, request)).status).toBe(201);
  });

  it("treats a store without hours as always open", async () => {
    const { service } = serviceWith([storedOrder], null, { slots: [], now: at("2026-11-02T04:00:00") });
    expect((await service.createOrder(restaurant.slug, request)).status).toBe(201);
  });

  it("keeps Monday 19:00–01:00 open on Tuesday at 00:30, then closes at 01:00", async () => {
    const open = serviceWith([storedOrder], null, { slots: [dinner], now: at("2026-11-03T00:30:00") });
    expect((await open.service.createOrder(restaurant.slug, request)).status).toBe(201);

    const closed = serviceWith([storedOrder], null, { slots: [dinner], now: at("2026-11-03T01:00:00") });
    await expect(closed.service.createOrder(restaurant.slug, request)).rejects.toMatchObject({ code: "STORE_CLOSED" });
  });

  it("checks the slot's fulfillment against the order's", async () => {
    const deliveryOnly: HoursSlot = { ...dinner, fulfillment: "delivery" };
    const { service } = serviceWith([storedOrder], null, { slots: [deliveryOnly], now: at("2026-11-02T20:00:00") });
    // `request` is a takeaway order.
    await expect(service.createOrder(restaurant.slug, request)).rejects.toMatchObject({ code: "STORE_CLOSED" });
  });
});

describe("domainErrorHandler logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never logs the bound params of a failed query", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("D1_ERROR: NOT NULL constraint failed: orders.number");
    const error = new DrizzleQueryError(
      "insert into orders (customer_name, customer_phone, delivery_address) values (?, ?, ?)",
      ["Juana Secreta", "5491199998888", "Calle Privada 742"],
      cause,
    );
    const app = new Hono<AppEnv>()
      .get("/", () => {
        throw error;
      })
      .onError(domainErrorHandler("test"));

    const res = await app.request("/");

    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("DrizzleQueryError");
    expect(logged).toContain(cause.message);
    for (const secret of ["Juana Secreta", "5491199998888", "Calle Privada 742"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
