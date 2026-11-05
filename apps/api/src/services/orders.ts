import {
  DEFAULT_SETTINGS,
  ORDER_EXPORT_MAX,
  ORDER_THROTTLE,
  buildOrderMessage,
  canTransition,
  checkSlug,
  hoursStatus,
  localDateKey,
  localDayRange,
  orderTotals,
  planLimitsFor,
  quoteDelivery,
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
import { createDeliveryRepository, type DeliveryRepository } from "../repositories/delivery";
import { createHoursRepository, type HoursRepository } from "../repositories/hours";
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
  DeliveryLocationRequiredError,
  ExportTooLargeError,
  FulfillmentNotOfferedError,
  InvalidTransitionError,
  OrderNotFoundError,
  OrderNumberConflictError,
  OutOfCoverageError,
  PaymentMethodNotAcceptedError,
  PriceChangedError,
  ProductUnavailableError,
  StoreClosedError,
  StorePausedError,
  TooManyOrdersError,
  ValidationError,
} from "./errors";
import { deliversByZones } from "./delivery";
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
  delivery: DeliveryRepository;
  hours: HoursRepository;
  now?: () => Date;
  generateId?: () => string;
}

/** How a delivery is priced and where it goes; takeaway orders get no shipping and no address. */
interface DeliveryTerms {
  shippingCents: number;
  /** Minimum subtotal: the zone's when it has one, else the store's. */
  minOrderCents: number | null;
  deliveryAddress: string | null;
  delivery: InsertOrderData["delivery"];
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
  delivery,
  hours,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
}: PublicOrdersDependencies) {
  /**
   * Shipping, minimum and address of the order. A store in `zones` mode quotes the geocoded address
   * (`OUT_OF_COVERAGE` when no active zone covers it); a `flat` store charges its single price and
   * keeps the typed address, taking the geocoded one only when there is none (a page opened while
   * the store was still in `zones` mode).
   */
  async function deliveryTerms(
    restaurant: RestaurantRow,
    storeSettings: StoreSettings,
    req: CreateOrderRequest,
    subtotalCents: number,
  ): Promise<DeliveryTerms> {
    const flat: DeliveryTerms = {
      shippingCents: storeSettings.shippingCents,
      minOrderCents: storeSettings.minOrderCents,
      deliveryAddress: null,
      delivery: null,
    };
    if (req.fulfillment !== "delivery") return flat;

    const location = await delivery.findLocation(restaurant.id);
    if (!deliversByZones(restaurant, location)) {
      return { ...flat, deliveryAddress: req.customer.address ?? req.delivery?.formattedAddress ?? null };
    }

    const address = req.delivery;
    if (!address) throw new DeliveryLocationRequiredError();
    const quote = quoteDelivery({
      zones: await delivery.listZones(restaurant.id),
      origin: { lat: location.lat, lng: location.lng },
      point: { lat: address.lat, lng: address.lng },
      subtotalCents,
    });
    if (!quote.covered) throw new OutOfCoverageError();

    return {
      shippingCents: quote.shippingCents,
      minOrderCents: quote.minOrderCents ?? storeSettings.minOrderCents,
      deliveryAddress: address.formattedAddress,
      delivery: {
        addressId: generateId(),
        lat: address.lat,
        lng: address.lng,
        placeId: address.placeId,
        formattedAddress: address.formattedAddress,
        locality: address.locality,
        unit: address.unit,
        betweenStreets: address.betweenStreets,
        label: address.label,
        zoneId: quote.zoneId,
        zoneName: quote.zoneName,
        distanceM: quote.distanceM,
      },
    };
  }

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

      // 4b. Opening hours: closed for this fulfillment refuses the order, unless the store takes
      // orders outside its hours. A store without hours is always open.
      const slots = await hours.listSlots(restaurant.id);
      const status = hoursStatus({ slots, acceptOrdersOutsideHours: storeSettings.acceptOrdersOutsideHours }, now(), req.fulfillment);
      if (!status.canOrder) {
        throw new StoreClosedError();
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

      // 9. Delivery terms: the flat price, or the quote of the address's zone (the diner's subtotal
      // decides free shipping, so it goes after pricing)
      const terms = await deliveryTerms(restaurant, storeSettings, req, priced.subtotalCents);

      // 10. Minimum order check (against the subtotal, not the total with shipping); a zone's minimum
      // replaces the store's
      if (terms.minOrderCents !== null && priced.subtotalCents < terms.minOrderCents) {
        throw new BelowMinimumError();
      }

      // 11. Total calculation and expected total check
      const totals = orderTotals({
        subtotalCents: priced.subtotalCents,
        shippingCents: terms.shippingCents,
        fulfillment: req.fulfillment,
      });
      if (req.expectedTotalCents !== totals.totalCents) {
        throw new PriceChangedError();
      }

      // 12. Write the order
      const { order, resent } = await insertOrder({
        orderId: generateId(),
        restaurantId: restaurant.id,
        clientToken: req.clientOrderId,
        customerId: generateId(),
        customerName: req.customer.name,
        customerPhone: req.customer.phone,
        deliveryAddress: terms.deliveryAddress,
        delivery: terms.delivery,
        fulfillment: req.fulfillment,
        paymentMethod: req.paymentMethod,
        ...totals,
        createdAt: now(),
        items: priced.items,
      });

      // 13. Build response
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
    delivery: createDeliveryRepository(db),
    hours: createHoursRepository(db),
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
  orders: OrdersRepository;
  now?: () => Date;
}

export function createOwnerOrdersService({
  orders,
  now = () => new Date(),
}: OwnerOrdersDependencies) {
  return {
    async list(restaurantId: string, query: OrderFiltersQuery) {
      return orders.list(restaurantId, toListFilter(query));
    },

    async getDetail(restaurantId: string, orderId: string) {
      const order = await orders.findDetail(restaurantId, orderId);
      if (!order) throw new OrderNotFoundError();
      return order;
    },

    async updateStatus(restaurantId: string, orderId: string, targetStatus: OrderStatus) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.status === targetStatus) return current;

      if (!canTransition(current.status, targetStatus, current.fulfillment)) {
        throw new InvalidTransitionError();
      }

      const updated = await orders.updateStatusIf(
        restaurantId,
        orderId,
        current.status,
        targetStatus,
        now(),
      );

      if (!updated) {
        const fresh = await orders.findDetail(restaurantId, orderId);
        if (fresh && fresh.status === targetStatus) return fresh;
        throw new InvalidTransitionError();
      }

      return updated;
    },

    async updatePayment(restaurantId: string, orderId: string, targetPaymentStatus: PaymentStatus) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.paymentStatus === targetPaymentStatus) return current;

      const updated = await orders.updatePaymentStatus(
        restaurantId,
        orderId,
        targetPaymentStatus,
        now(),
      );

      if (!updated) throw new OrderNotFoundError();
      return updated;
    },

    async exportCsv(restaurantId: string, query: OrderFiltersQuery) {
      // One row past the cap tells "too many" apart from "exactly the cap".
      const list = await orders.listForExport(restaurantId, toListFilter(query), ORDER_EXPORT_MAX + 1);
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
    orders: createOrdersRepository(db),
  });
}
