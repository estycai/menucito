import {
  DEFAULT_SETTINGS,
  ORDER_EXPORT_MAX,
  ORDER_THROTTLE,
  buildOrderMessage,
  canTransition,
  checkSlug,
  localDateKey,
  localDayRange,
  orderTotals,
  planLimitsFor,
  toPublicOrder,
  unitPriceCents,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type OrderDetail,
  type OrderFiltersQuery,
  type OrderPaymentInfo,
  type OrderStatus,
  type PaymentStatus,
  type StoreSettings,
} from "@menucito/shared";
import type { IngredientRow, ProductRow, RestaurantRow } from "../db/schema";
import { UniqueViolationError } from "../repositories/errors";
import { createIngredientsRepository, type IngredientsRepository } from "../repositories/ingredients";
import {
  createOrdersRepository,
  type InsertOrderData,
  type ListOrdersFilter,
  type OrdersRepository,
} from "../repositories/orders";
import { createProductsRepository, type ProductsRepository } from "../repositories/products";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createSettingsRepository, type SettingsRepository } from "../repositories/settings";
import {
  BelowMinimumError,
  ExportTooLargeError,
  FulfillmentNotOfferedError,
  InvalidTransitionError,
  OrderNotFoundError,
  OrderNumberConflictError,
  PaymentMethodNotAcceptedError,
  PriceChangedError,
  ProductUnavailableError,
  RestaurantNotFoundError,
  StorePausedError,
  TooManyOrdersError,
  ValidationError,
} from "./errors";
import { ordersToCsv } from "./orders-csv";
import { MenuNotFoundError } from "./public-menu";

/** Attempts at inserting an order whose number keeps colliding with concurrent orders. */
const ORDER_INSERT_ATTEMPTS = 3;

export interface PublicOrdersDependencies {
  restaurants: RestaurantsRepository;
  settings: SettingsRepository;
  orders: OrdersRepository;
  products: ProductsRepository;
  ingredients: IngredientsRepository;
  now?: () => Date;
  generateId?: () => string;
}

/** Response of a placed (or replayed) order: the public order, its WhatsApp link and the transfer details. */
function buildCreateOrderResponse(
  order: OrderDetail,
  restaurant: Pick<RestaurantRow, "name" | "whatsapp">,
  settings: StoreSettings,
): CreateOrderResponse {
  const transfer = settings.paymentMethods.find((pm) => pm.method === "transfer");
  const payment: OrderPaymentInfo | null =
    order.paymentMethod === "transfer"
      ? { alias: transfer?.alias ?? null, holderName: transfer?.holderName ?? null }
      : null;
  const whatsappUrl = `https://wa.me/${restaurant.whatsapp}?text=${encodeURIComponent(
    buildOrderMessage(order, { restaurantName: restaurant.name, payment }),
  )}`;
  return { order: toPublicOrder(order), whatsappUrl, payment };
}

interface PriceItemsInput {
  items: CreateOrderRequest["items"];
  productsById: ReadonlyMap<string, ProductRow>;
  ingredientsByProduct: ReadonlyMap<string, IngredientRow[]>;
  /** Whether the plan lets the diner customize ingredients. */
  withIngredients: boolean;
  generateId: () => string;
}

/**
 * Validates every requested line against the current menu and prices it from the database (never
 * from the client). Returns the item rows to insert and the subtotal.
 */
function priceItems({ items, productsById, ingredientsByProduct, withIngredients, generateId }: PriceItemsInput): {
  items: InsertOrderData["items"];
  subtotalCents: number;
} {
  let subtotalCents = 0;
  const rows: InsertOrderData["items"] = [];

  for (const [position, itemReq] of items.entries()) {
    const product = productsById.get(itemReq.productId);
    if (!product || !product.available) {
      throw new ProductUnavailableError(product ? product.name : "Producto no disponible");
    }

    const prodIngredients = ingredientsByProduct.get(product.id) ?? [];
    const ingredientsByName = new Map(prodIngredients.map((i) => [i.name, i]));
    const choices = itemReq.choices ?? {};

    if (!withIngredients) {
      // On Basic plan, only empty choices (or choosing included quantity) are allowed
      for (const [name, qty] of Object.entries(choices)) {
        const ing = ingredientsByName.get(name);
        if (ing && qty === ing.includedQty) {
          continue;
        }
        throw new ValidationError("El plan no permite ingredientes personalizados");
      }
    } else {
      // Validate choices against published ingredients
      for (const [name, qty] of Object.entries(choices)) {
        const ing = ingredientsByName.get(name);
        if (!ing) {
          throw new ValidationError(`El ingrediente "${name}" no existe en el producto`);
        }
        if (!Number.isInteger(qty) || qty < ing.minQty || qty > ing.maxQty) {
          throw new ValidationError(`Cantidad inválida para "${name}"`);
        }
      }
    }

    // Calculate unit price from base + extra
    const unitPrice = unitPriceCents({ priceCents: product.priceCents, ingredients: prodIngredients }, choices);

    // Build options_json only for differing quantities
    const differingOptions = prodIngredients
      .filter((ing) => {
        const chosen = choices[ing.name];
        return chosen !== undefined && chosen !== ing.includedQty;
      })
      .map((ing) => ({
        name: ing.name,
        quantity: choices[ing.name]!,
        includedQty: ing.includedQty,
        extraPriceCents: ing.extraPriceCents,
      }));

    rows.push({
      id: generateId(),
      productId: product.id,
      position,
      name: product.name,
      unitPriceCents: unitPrice,
      quantity: itemReq.quantity,
      optionsJson: differingOptions.length > 0 ? JSON.stringify(differingOptions) : null,
    });

    subtotalCents += unitPrice * itemReq.quantity;
  }

  return { items: rows, subtotalCents };
}

export function createPublicOrdersService({
  restaurants,
  settings,
  orders,
  products,
  ingredients,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
}: PublicOrdersDependencies) {
  /**
   * Inserts the order, retrying when its number collides with a concurrent order. A token collision
   * means a concurrent request with the same `clientOrderId` won: its order is returned as resent
   * (scenario 25: the replay is a 200). Any other failure is rethrown untouched.
   */
  async function insertOrder(data: InsertOrderData): Promise<{ order: OrderDetail; resent: boolean }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return { order: await orders.insertOrder(data), resent: false };
      } catch (error) {
        if (!(error instanceof UniqueViolationError)) throw error;
        if (error.columns.includes("client_token")) {
          const raced = await orders.findByToken(data.restaurantId, data.clientToken);
          if (raced) return { order: raced, resent: true };
          throw error;
        }
        if (!error.columns.includes("number")) throw error;
        if (attempt >= ORDER_INSERT_ATTEMPTS) throw new OrderNumberConflictError();
      }
    }
  }

  return {
    async createOrder(
      slug: string,
      req: CreateOrderRequest,
    ): Promise<{ status: 200 | 201; response: CreateOrderResponse }> {
      // 1. Slug check
      if (checkSlug(slug)) throw new MenuNotFoundError();

      // 2. Restaurant lookup
      const restaurant = await restaurants.findBySlug(slug);
      if (!restaurant) throw new MenuNotFoundError();

      // 3. Idempotency: a known clientOrderId replays the stored order
      const existing = await orders.findByToken(restaurant.id, req.clientOrderId);
      const storedSettings = await settings.findSettings(restaurant.id);
      if (!storedSettings) {
        console.warn(`[orders] restaurant ${restaurant.id} missing settings row, using safe defaults`);
      }
      const storeSettings = storedSettings ?? DEFAULT_SETTINGS;

      if (existing) {
        return { status: 200, response: buildCreateOrderResponse(existing, restaurant, storeSettings) };
      }

      // 4. Pause check
      if (!storeSettings.acceptingOrders) {
        throw new StorePausedError();
      }

      // 5. Phone throttle: at most 3 orders in 10 minutes
      const since = new Date(now().getTime() - ORDER_THROTTLE.windowMs);
      const recentCount = await orders.countRecentByPhone(restaurant.id, req.customer.phone, since);
      if (recentCount >= ORDER_THROTTLE.maxOrders) {
        throw new TooManyOrdersError();
      }

      // 6. Fulfillment check
      if (req.fulfillment === "delivery" && !restaurant.delivery) {
        throw new FulfillmentNotOfferedError();
      }
      if (req.fulfillment === "takeaway" && !restaurant.takeaway) {
        throw new FulfillmentNotOfferedError();
      }

      // 7. Payment method check
      const chosenMethod = storeSettings.paymentMethods.find((pm) => pm.method === req.paymentMethod);
      if (!chosenMethod || !chosenMethod.enabled) {
        throw new PaymentMethodNotAcceptedError();
      }

      // 8. Products and ingredient choices
      const allProducts = await products.list(restaurant.id);
      const withIngredients = planLimitsFor(restaurant.plan).customIngredients;
      const allIngredients = withIngredients ? await ingredients.listByRestaurant(restaurant.id) : [];
      const ingredientsByProduct = new Map<string, IngredientRow[]>();
      for (const row of allIngredients) {
        const list = ingredientsByProduct.get(row.productId) ?? [];
        list.push(row);
        ingredientsByProduct.set(row.productId, list);
      }

      const priced = priceItems({
        items: req.items,
        productsById: new Map(allProducts.map((p) => [p.id, p])),
        ingredientsByProduct,
        withIngredients,
        generateId,
      });

      // 9. Minimum order check (against the subtotal, not the total with shipping)
      if (storeSettings.minOrderCents !== null && priced.subtotalCents < storeSettings.minOrderCents) {
        throw new BelowMinimumError();
      }

      // 10. Total calculation and expected total check
      const totals = orderTotals({
        subtotalCents: priced.subtotalCents,
        shippingCents: storeSettings.shippingCents,
        fulfillment: req.fulfillment,
      });
      if (req.expectedTotalCents !== totals.totalCents) {
        throw new PriceChangedError();
      }

      // 11. Write the order
      const { order, resent } = await insertOrder({
        orderId: generateId(),
        restaurantId: restaurant.id,
        clientToken: req.clientOrderId,
        customerId: generateId(),
        customerName: req.customer.name,
        customerPhone: req.customer.phone,
        deliveryAddress: req.customer.address ?? null,
        fulfillment: req.fulfillment,
        paymentMethod: req.paymentMethod,
        ...totals,
        createdAt: now(),
        items: priced.items,
      });

      // 12. Build response
      return { status: resent ? 200 : 201, response: buildCreateOrderResponse(order, restaurant, storeSettings) };
    },
  };
}

export type PublicOrdersService = ReturnType<typeof createPublicOrdersService>;

export function publicOrdersServiceFor(db: D1Database): PublicOrdersService {
  return createPublicOrdersService({
    restaurants: createRestaurantsRepository(db),
    settings: createSettingsRepository(db),
    orders: createOrdersRepository(db),
    products: createProductsRepository(db),
    ingredients: createIngredientsRepository(db),
  });
}

/** Turns the validated query into the repository filter: local calendar days become UTC bounds. */
function toListFilter(query: OrderFiltersQuery): ListOrdersFilter {
  const { from, to, ...rest } = query;
  const filter: ListOrdersFilter = { ...rest };
  if (from) filter.fromMs = localDayRange(from)[0];
  if (to) filter.toMs = localDayRange(to)[1];
  return filter;
}

export interface OwnerOrdersDependencies {
  restaurants: RestaurantsRepository;
  orders: OrdersRepository;
  now?: () => Date;
}

export function createOwnerOrdersService({
  restaurants,
  orders,
  now = () => new Date(),
}: OwnerOrdersDependencies) {
  async function resolveRestaurant(ownerId: string) {
    const restaurant = await restaurants.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant;
  }

  return {
    async list(ownerId: string, query: OrderFiltersQuery) {
      const restaurant = await resolveRestaurant(ownerId);
      return orders.list(restaurant.id, toListFilter(query));
    },

    async getDetail(ownerId: string, orderId: string) {
      const restaurant = await resolveRestaurant(ownerId);
      const order = await orders.findDetail(restaurant.id, orderId);
      if (!order) throw new OrderNotFoundError();
      return order;
    },

    async updateStatus(ownerId: string, orderId: string, targetStatus: OrderStatus) {
      const restaurant = await resolveRestaurant(ownerId);
      const current = await orders.findDetail(restaurant.id, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.status === targetStatus) return current;

      if (!canTransition(current.status, targetStatus, current.fulfillment)) {
        throw new InvalidTransitionError();
      }

      const updated = await orders.updateStatusIf(
        restaurant.id,
        orderId,
        current.status,
        targetStatus,
        now(),
      );

      if (!updated) {
        const fresh = await orders.findDetail(restaurant.id, orderId);
        if (fresh && fresh.status === targetStatus) return fresh;
        throw new InvalidTransitionError();
      }

      return updated;
    },

    async updatePayment(ownerId: string, orderId: string, targetPaymentStatus: PaymentStatus) {
      const restaurant = await resolveRestaurant(ownerId);
      const current = await orders.findDetail(restaurant.id, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.paymentStatus === targetPaymentStatus) return current;

      const updated = await orders.updatePaymentStatus(
        restaurant.id,
        orderId,
        targetPaymentStatus,
        now(),
      );

      if (!updated) throw new OrderNotFoundError();
      return updated;
    },

    async exportCsv(ownerId: string, query: OrderFiltersQuery) {
      const restaurant = await resolveRestaurant(ownerId);
      // One row past the cap tells "too many" apart from "exactly the cap".
      const list = await orders.listForExport(restaurant.id, toListFilter(query), ORDER_EXPORT_MAX + 1);
      if (list.length > ORDER_EXPORT_MAX) {
        throw new ExportTooLargeError();
      }
      const csv = ordersToCsv(list);
      const filename = `pedidos-${localDateKey(now().getTime())}.csv`;
      return { csv, filename };
    },
  };
}

export type OwnerOrdersService = ReturnType<typeof createOwnerOrdersService>;

export function ordersServiceFor(db: D1Database): OwnerOrdersService {
  return createOwnerOrdersService({
    restaurants: createRestaurantsRepository(db),
    orders: createOrdersRepository(db),
  });
}
