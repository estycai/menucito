import {
  DEFAULT_SETTINGS,
  FULFILLMENTS,
  ORDER_STATUSES,
  ORDER_THROTTLE,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  buildOrderMessage,
  canTransition,
  checkSlug,
  localDateKey,
  localDayRange,
  planLimitsFor,
  toPublicOrder,
  unitPriceCents,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type Fulfillment,
  type OrderDetail,
  type OrderPaymentInfo,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type PricedProduct,
} from "@menucito/shared";
import type { IngredientRow } from "../db/schema";
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
  PaymentMethodNotAcceptedError,
  PriceChangedError,
  ProductUnavailableError,
  RestaurantNotFoundError,
  StorePausedError,
  TooManyOrdersError,
  ValidationError,
} from "./errors";
import { ordersToCsv } from "./orders-csv";

export class MenuNotFoundError extends RestaurantNotFoundError {}

export interface PublicOrdersDependencies {
  restaurants: RestaurantsRepository;
  settings: SettingsRepository;
  orders: OrdersRepository;
  products: ProductsRepository;
  ingredients: IngredientsRepository;
  now?: () => Date;
  generateId?: () => string;
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

      // 3. Idempotency: check if clientOrderId already exists
      const existing = await orders.findByToken(restaurant.id, req.clientOrderId);
      const storeSettings = (await settings.findSettings(restaurant.id)) ?? DEFAULT_SETTINGS;
      const transferMethodSetting = storeSettings.paymentMethods.find((pm) => pm.method === "transfer");

      if (existing) {
        const payment: OrderPaymentInfo | null =
          existing.paymentMethod === "transfer"
            ? {
                alias: transferMethodSetting?.alias ?? null,
                holderName: transferMethodSetting?.holderName ?? null,
              }
            : null;

        const whatsappUrl = `https://wa.me/${restaurant.whatsapp}?text=${encodeURIComponent(
          buildOrderMessage(existing, { restaurantName: restaurant.name, payment }),
        )}`;

        return {
          status: 200,
          response: {
            order: toPublicOrder(existing),
            whatsappUrl,
            payment,
          },
        };
      }

      // 4. Pause check
      if (!storeSettings.acceptingOrders) {
        throw new StorePausedError();
      }

      // 5. Phone throttle: at most 3 orders in 10 minutes
      const windowMs = ORDER_THROTTLE.windowMs;
      const since = new Date(now().getTime() - windowMs);
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
      const productsById = new Map(allProducts.map((p) => [p.id, p]));

      const withIngredients = planLimitsFor(restaurant.plan).customIngredients;
      const allIngredients = withIngredients ? await ingredients.listByRestaurant(restaurant.id) : [];
      const ingredientsByProduct = new Map<string, IngredientRow[]>();
      for (const row of allIngredients) {
        const list = ingredientsByProduct.get(row.productId) ?? [];
        list.push(row);
        ingredientsByProduct.set(row.productId, list);
      }

      let subtotalCents = 0;
      const orderItemsData: InsertOrderData["items"] = [];

      for (let pos = 0; pos < req.items.length; pos++) {
        const itemReq = req.items[pos]!;
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
        const pricedProd: PricedProduct = {
          priceCents: product.priceCents,
          ingredients: prodIngredients,
        };
        const unitPrice = unitPriceCents(pricedProd, choices);

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

        orderItemsData.push({
          id: generateId(),
          productId: product.id,
          position: pos,
          name: product.name,
          unitPriceCents: unitPrice,
          quantity: itemReq.quantity,
          optionsJson: differingOptions.length > 0 ? JSON.stringify(differingOptions) : null,
        });

        subtotalCents += unitPrice * itemReq.quantity;
      }

      // 9. Minimum order check
      if (storeSettings.minOrderCents !== null && subtotalCents < storeSettings.minOrderCents) {
        throw new BelowMinimumError();
      }

      // 10. Total calculation and expected total check
      const shippingCents = req.fulfillment === "delivery" ? storeSettings.shippingCents : 0;
      const totalCents = subtotalCents + shippingCents;

      if (req.expectedTotalCents !== totalCents) {
        throw new PriceChangedError();
      }

      // 11. Write order with retry up to 3 times
      const orderId = generateId();
      const customerId = generateId();
      let order: OrderDetail | null = null;
      // True when a concurrent request with the same token won the insert (scenario 25: replay is a 200).
      let resent = false;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          order = await orders.insertOrder({
            orderId,
            restaurantId: restaurant.id,
            clientToken: req.clientOrderId,
            customerId,
            customerName: req.customer.name,
            customerPhone: req.customer.phone,
            deliveryAddress: req.customer.address ?? null,
            fulfillment: req.fulfillment,
            paymentMethod: req.paymentMethod,
            subtotalCents,
            shippingCents,
            totalCents,
            createdAt: now(),
            items: orderItemsData,
          });
          break;
        } catch (err) {
          lastError = err;
          // Check if another concurrent attempt with same clientOrderId won
          const raced = await orders.findByToken(restaurant.id, req.clientOrderId);
          if (raced) {
            order = raced;
            resent = true;
            break;
          }
        }
      }

      if (!order) throw (lastError ?? new Error("Failed to create order"));

      // 12. Build response
      const payment: OrderPaymentInfo | null =
        req.paymentMethod === "transfer"
          ? {
              alias: transferMethodSetting?.alias ?? null,
              holderName: transferMethodSetting?.holderName ?? null,
            }
          : null;

      const whatsappUrl = `https://wa.me/${restaurant.whatsapp}?text=${encodeURIComponent(
        buildOrderMessage(order, { restaurantName: restaurant.name, payment }),
      )}`;

      return {
        status: resent ? 200 : 201,
        response: {
          order: toPublicOrder(order),
          whatsappUrl,
          payment,
        },
      };
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

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `val` is a YYYY-MM-DD key naming a real calendar day (2026-02-31 is not). */
function isCalendarDate(val: string): boolean {
  const match = DATE_FORMAT.exec(val);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseDateParam(val: string | undefined, fieldName: string): [number, number] | undefined {
  if (!val) return undefined;
  if (!isCalendarDate(val)) {
    throw new ValidationError(`Fecha ${fieldName} inválida`);
  }
  const range = localDayRange(val);
  if (isNaN(range[0]) || isNaN(range[1])) {
    throw new ValidationError(`Fecha ${fieldName} inválida`);
  }
  return range;
}

export interface RawListOrdersFilter {
  status?: string;
  fulfillment?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  from?: string;
  to?: string;
  limit?: string | number;
  before?: string | number;
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

  function parseFilter(raw: RawListOrdersFilter): ListOrdersFilter {
    const filter: ListOrdersFilter = {};

    if (raw.status !== undefined && raw.status !== "") {
      if (raw.status !== "active" && !ORDER_STATUSES.includes(raw.status as OrderStatus)) {
        throw new ValidationError("Estado inválido");
      }
      filter.status = raw.status as OrderStatus | "active";
    }

    if (raw.fulfillment !== undefined && raw.fulfillment !== "") {
      if (!FULFILLMENTS.includes(raw.fulfillment as Fulfillment)) {
        throw new ValidationError("Modalidad inválida");
      }
      filter.fulfillment = raw.fulfillment as Fulfillment;
    }

    if (raw.paymentMethod !== undefined && raw.paymentMethod !== "") {
      if (!PAYMENT_METHODS.includes(raw.paymentMethod as PaymentMethod)) {
        throw new ValidationError("Forma de pago inválida");
      }
      filter.paymentMethod = raw.paymentMethod as PaymentMethod;
    }

    if (raw.paymentStatus !== undefined && raw.paymentStatus !== "") {
      if (!PAYMENT_STATUSES.includes(raw.paymentStatus as PaymentStatus)) {
        throw new ValidationError("Estado de pago inválido");
      }
      filter.paymentStatus = raw.paymentStatus as PaymentStatus;
    }

    if (raw.from !== undefined && raw.from !== "") {
      const range = parseDateParam(raw.from, "desde");
      if (range) filter.fromMs = range[0];
    }

    if (raw.to !== undefined && raw.to !== "") {
      const range = parseDateParam(raw.to, "hasta");
      if (range) filter.toMs = range[1];
    }

    // YYYY-MM-DD keys compare chronologically as strings; comparing the ms bounds would let from = to + 1 day through.
    if (raw.from && raw.to && raw.from > raw.to) {
      throw new ValidationError("Rango de fechas inválido");
    }

    if (raw.before !== undefined && raw.before !== "") {
      const num = Number(raw.before);
      if (!Number.isInteger(num) || num <= 0) {
        throw new ValidationError("Cursor inválido");
      }
      filter.before = num;
    }

    if (raw.limit !== undefined && raw.limit !== "") {
      const num = Number(raw.limit);
      if (!Number.isInteger(num) || num <= 0) {
        throw new ValidationError("Límite inválido");
      }
      filter.limit = num;
    }

    return filter;
  }

  return {
    async list(ownerId: string, rawFilter: RawListOrdersFilter) {
      const restaurant = await resolveRestaurant(ownerId);
      const filter = parseFilter(rawFilter);
      return orders.list(restaurant.id, filter);
    },

    async getDetail(ownerId: string, orderId: string) {
      const restaurant = await resolveRestaurant(ownerId);
      const order = await orders.findDetail(restaurant.id, orderId);
      if (!order) throw new OrderNotFoundError();
      return order;
    },

    async updateStatus(ownerId: string, orderId: string, newStatus: string) {
      const restaurant = await resolveRestaurant(ownerId);
      if (!ORDER_STATUSES.includes(newStatus as OrderStatus)) {
        throw new ValidationError("Estado desconocido");
      }
      const targetStatus = newStatus as OrderStatus;
      const current = await orders.findDetail(restaurant.id, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.status === targetStatus) return current;

      if (!canTransition(current.status, targetStatus)) {
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

    async updatePayment(ownerId: string, orderId: string, newPaymentStatus: string) {
      const restaurant = await resolveRestaurant(ownerId);
      if (!PAYMENT_STATUSES.includes(newPaymentStatus as PaymentStatus)) {
        throw new ValidationError("Estado de pago desconocido");
      }
      const targetPaymentStatus = newPaymentStatus as PaymentStatus;
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

    async exportCsv(ownerId: string, rawFilter: RawListOrdersFilter) {
      const restaurant = await resolveRestaurant(ownerId);
      const filter = parseFilter(rawFilter);
      const list = await orders.listForExport(restaurant.id, filter);
      if (list.length > 5000) {
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
