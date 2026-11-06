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
  CASH_TENDERED_MAX_CENTS,
  PAYMENT_SPLIT_MESSAGES,
  splitCashProblem,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type OrderDetail,
  type OrderFiltersQuery,
  type OrderPaymentInfo,
  type OrderStatus,
  type PaymentStatus,
  type StoreSettings,
  type UpdateOrderPaymentMethodInput,
} from "@menucito/shared";
import type { IngredientRow, ProductRow, RestaurantRow } from "../db/schema";
import { createCashRepository, type CashRepository } from "../repositories/cash";
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
import { createMembersRepository, type MembersRepository } from "../repositories/members";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createSettingsRepository, type SettingsRepository } from "../repositories/settings";
import {
  BelowMinimumError,
  CashSessionClosedError,
  ConcurrentModificationError,
  CourierRequiredError,
  DeliveryLocationRequiredError,
  ExportTooLargeError,
  FulfillmentNotOfferedError,
  InvalidTransitionError,
  OrderNotFoundError,
  OrderNumberConflictError,
  OrderSettledError,
  OutOfCoverageError,
  PaymentMethodNotAcceptedError,
  PaymentLockedError,
  PriceChangedError,
  ProductUnavailableError,
  StoreClosedError,
  StorePausedError,
  TooManyOrdersError,
  ValidationError,
} from "./errors";
import { buildOrderSplitIncomeRows } from "./cash";
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
    order.paymentMethod === "transfer" || order.paymentMethod === "split"
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

      // 7. Payment method check: split also needs cash and transfer enabled.
      const chosenMethod = storeSettings.paymentMethods.find((pm) => pm.method === req.paymentMethod);
      const splitReady =
        req.paymentMethod !== "split" ||
        (storeSettings.paymentMethods.some((pm) => pm.method === "cash" && pm.enabled) &&
          storeSettings.paymentMethods.some((pm) => pm.method === "transfer" && pm.enabled));
      if (req.paymentMethod === "split" && (!chosenMethod?.enabled || !splitReady)) {
        throw new ValidationError(PAYMENT_SPLIT_MESSAGES.splitNeedsBoth);
      }
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
        tipCents: req.tipCents,
        fulfillment: req.fulfillment,
      });
      if (req.expectedTotalCents !== totals.totalCents) {
        throw new PriceChangedError();
      }
      // The split is validated against the total recalculated from the database, not the client's.
      if (req.paymentMethod === "split") {
        const splitProblem =
          typeof req.splitCashCents !== "number"
            ? "splitRange"
            : splitCashProblem(req.splitCashCents, totals.totalCents, totals.tipCents);
        if (splitProblem) throw new ValidationError(PAYMENT_SPLIT_MESSAGES[splitProblem]);
      }
      if (
        req.cashTenderedCents !== null &&
        req.cashTenderedCents > CASH_TENDERED_MAX_CENTS
      ) {
        throw new ValidationError(PAYMENT_SPLIT_MESSAGES.tenderedTooHigh);
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
        splitCashCents: req.splitCashCents ?? null,
        cashTenderedCents: req.cashTenderedCents ?? null,
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
  /** Needed to validate the courier of an assignment and to know if a member has orders. */
  members: MembersRepository;
  cash: CashRepository;
  now?: () => Date;
  generateId?: () => string;
}

export function createOwnerOrdersService({
  orders,
  members,
  cash,
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
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

    /**
     * Assigns a courier and passes the order to `sent` (decision 5). A `ready` or `sent` delivery
     * order changes; anything else is a 409. Two simultaneous assignments: the conditional write lets
     * one win and the other gets `CONCURRENT_MODIFICATION`.
     */
    async assignCourier(restaurantId: string, orderId: string, courierMemberId: string) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();

      const courier = await members.find(restaurantId, courierMemberId);
      if (!courier || !courier.member.active || !courier.member.isCourier) {
        throw new ValidationError("courierMemberId: elegí un repartidor activo de tu local");
      }

      if (current.fulfillment !== "delivery" || (current.status !== "ready" && current.status !== "sent")) {
        throw new InvalidTransitionError();
      }

      const updated = await orders.assignCourierIf(restaurantId, orderId, courierMemberId, current.status, now());
      if (!updated) throw new ConcurrentModificationError();
      return updated;
    },

    async updateStatus(restaurantId: string, orderId: string, targetStatus: OrderStatus) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.status === targetStatus) return current;

      if (!canTransition(current.status, targetStatus, current.fulfillment)) {
        throw new InvalidTransitionError();
      }

      // To `sent` only through `assignCourier`: that is the only path that picks who carries it.
      if (targetStatus === "sent") throw new CourierRequiredError();

      const at = now();
      const updated =
        targetStatus === "delivered"
          ? await orders.markDeliveredIf(restaurantId, orderId, current.status, { markPaid: current.paymentMethod === "cash" || current.paymentMethod === "split" }, at)
          : await orders.updateStatusIf(restaurantId, orderId, current.status, targetStatus, at);

      if (!updated) {
        const fresh = await orders.findDetail(restaurantId, orderId);
        if (fresh && fresh.status === targetStatus) return fresh;
        throw new InvalidTransitionError();
      }

      // Cancelling while the session is open takes the order out of its totals; the automatic split
      // incomes go with it. A closed session is a snapshot and never changes.
      if (targetStatus === "cancelled" && current.cashSessionId) {
        const open = await cash.findOpenSession(restaurantId);
        if (open && open.id === current.cashSessionId) {
          await cash.deleteOrderSplitIncomes(restaurantId, open.id, orderId);
        }
      }

      return updated;
    },

    /**
     * Marks an order paid or pending. Paid enters the open cash when the money lands there: any
     * transfer, and cash or split takeaway. Delivery cash and split orders stay "to settle" until
     * someone taps "Ingresar a la caja" (change 14b).
     */
    async updatePayment(
      restaurantId: string,
      member: { memberId: string },
      orderId: string,
      targetPaymentStatus: PaymentStatus,
    ) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();

      if (current.paymentStatus === targetPaymentStatus) return current;

      if (targetPaymentStatus === "pending") {
        if (current.cashSessionId || current.settledAt != null) {
          if (current.cashSessionId) {
            const session = await cash.findSession(restaurantId, current.cashSessionId);
            if (!session || session.closedAt) throw new CashSessionClosedError();
          }
          throw new OrderSettledError();
        }
        const reverted = await orders.updatePaymentStatus(restaurantId, orderId, "pending", now());
        if (!reverted) throw new OrderNotFoundError();
        return reverted;
      }

      const open = await cash.findOpenSession(restaurantId);
      // A cancelled order is never money that reached the drawer.
      const entersCash =
        current.status !== "cancelled" &&
        (current.paymentMethod === "transfer" || current.fulfillment === "takeaway");
      const cashSessionId = entersCash ? (open?.id ?? null) : null;
      const paidAt = now();
      let rows: ReturnType<typeof buildOrderSplitIncomeRows> = [];
      if (current.paymentMethod === "split" && cashSessionId) {
        const record = await members.find(restaurantId, member.memberId);
        const name = record ? `${record.member.firstName} ${record.member.lastName}`.trim() || "Usuario" : "Usuario";
        rows = buildOrderSplitIncomeRows(
          current,
          restaurantId,
          cashSessionId,
          member,
          name,
          paidAt,
          generateId,
        );
      }
      await cash.markOrderPaid(restaurantId, orderId, cashSessionId, paidAt, rows);

      const updated = await orders.findDetail(restaurantId, orderId);
      if (!updated) throw new OrderNotFoundError();
      return updated;
    },

    /**
     * Changes the payment method of an order that is not paid nor cancelled. Moving to cash drops the
     * tip and recalculates the total (a tip only exists with transfer).
     */
    async updatePaymentMethod(
      restaurantId: string,
      orderId: string,
      input: UpdateOrderPaymentMethodInput,
    ) {
      const current = await orders.findDetail(restaurantId, orderId);
      if (!current) throw new OrderNotFoundError();
      if (current.paymentStatus === "paid" || current.cashSessionId || current.settledAt != null) {
        throw new PaymentLockedError();
      }
      // A cancelled order is closed, and a delivered one already settled its tip and the cash the
      // courier collected: changing its method would leave it unpaid forever.
      if (current.status === "cancelled" || current.status === "delivered") throw new InvalidTransitionError();
      if (input.expectedStatus !== current.status) {
        throw new ConcurrentModificationError();
      }

      const totals = orderTotals({
        subtotalCents: current.subtotalCents,
        shippingCents: current.shippingCents,
        tipCents: input.paymentMethod === "cash" ? 0 : current.tipCents,
        fulfillment: current.fulfillment,
      });
      const splitCashCents = input.paymentMethod === "split" ? (input.splitCashCents ?? null) : null;
      if (input.paymentMethod === "split") {
        const splitProblem =
          splitCashCents === null ? "splitRange" : splitCashProblem(splitCashCents, totals.totalCents, totals.tipCents);
        if (splitProblem) throw new ValidationError(PAYMENT_SPLIT_MESSAGES[splitProblem]);
      }
      const cashTenderedCents =
        input.paymentMethod === "transfer" ? null : (input.cashTenderedCents ?? null);
      if (cashTenderedCents !== null) {
        const cashCents = input.paymentMethod === "cash" ? totals.totalCents : (splitCashCents ?? 0);
        if (cashTenderedCents < cashCents) {
          throw new ValidationError(PAYMENT_SPLIT_MESSAGES.tenderedTooLow);
        }
      }

      const updated = await orders.updatePaymentMethodIf(
        restaurantId,
        orderId,
        current.status,
        {
          paymentMethod: input.paymentMethod,
          splitCashCents,
          cashTenderedCents,
          tipCents: totals.tipCents,
          totalCents: totals.totalCents,
        },
        now(),
      );
      if (updated) return updated;

      const fresh = await orders.findDetail(restaurantId, orderId);
      if (!fresh) throw new OrderNotFoundError();
      if (fresh.status === "cancelled" || fresh.status === "delivered") throw new InvalidTransitionError();
      if (fresh.paymentStatus === "paid") throw new PaymentLockedError();
      throw new ConcurrentModificationError();
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
    members: createMembersRepository(db),
    cash: createCashRepository(db),
  });
}
