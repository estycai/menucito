import { z } from "zod";
import { formatArs } from "./catalog";
import {
  FULFILLMENTS,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_MESSAGES,
  ORDER_NAME_MAX_LENGTH,
  PAYMENT_METHODS,
  type Fulfillment,
  type PaymentMethod,
} from "./order";
import { type AddressLabel, orderDeliverySchema } from "./delivery";
import { normalizeArWhatsapp } from "./restaurant";
import { isCalendarDateKey } from "./time";

export const ORDER_STATUSES = ["new", "preparing", "ready", "sent", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order came from: the public menu, the counter or WhatsApp. */
export const ORDER_SOURCES = ["web", "local", "whatsapp"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
/** Sources an employee can pick when creating an order from the admin. */
export const MANUAL_ORDER_SOURCES = ["local", "whatsapp"] as const;
export type ManualOrderSource = (typeof MANUAL_ORDER_SOURCES)[number];
export const ORDER_SOURCE_LABELS: Readonly<Record<OrderSource, string>> = {
  web: "Web",
  local: "Local",
  whatsapp: "WhatsApp",
};

/** Comment of the whole order, typed by the employee when creating it manually. */
export const ORDER_NOTES_MAX_LENGTH = 500;

/** Statuses of an order that has not finished yet; `sent` is still on its way to the customer. */
export const ACTIVE_ORDER_STATUSES = ["new", "preparing", "ready", "sent"] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: "Nuevo",
  preparing: "En preparación",
  ready: "Listo",
  sent: "Enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  pending: "Pendiente",
  paid: "Pagado",
};

/** Forward pipeline of each fulfillment: a takeaway order is never sent, it goes from ready to delivered. */
const STATUS_PIPELINES: Record<Fulfillment, readonly OrderStatus[]> = {
  delivery: ["new", "preparing", "ready", "sent", "delivered"],
  takeaway: ["new", "preparing", "ready", "delivered"],
};

/**
 * Whether an order of the given fulfillment may move from `from` to `to`: forward along its
 * pipeline (skipping steps is allowed) or to `cancelled` while active. `delivered` and
 * `cancelled` are final.
 */
export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  // Every active status may be cancelled, `sent` included (the courier did not find the customer).
  if (to === "cancelled") return (ACTIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(from);
  const pipeline = STATUS_PIPELINES[fulfillment];
  const fromIndex = pipeline.indexOf(from);
  const toIndex = pipeline.indexOf(to);
  return fromIndex !== -1 && toIndex !== -1 && toIndex > fromIndex;
}

/** The next step of the order's pipeline, or `null` from a final status. */
export function nextStatus(from: OrderStatus, fulfillment: Fulfillment): OrderStatus | null {
  const pipeline = STATUS_PIPELINES[fulfillment];
  const index = pipeline.indexOf(from);
  // -1 (cancelled or unknown) yields null too: `delivered` is the last step of every pipeline.
  if (index === -1) return null;
  return pipeline[index + 1] ?? null;
}

/** Tip percentages the diner may pick; the amount is calculated over the products subtotal. */
export const TIP_PERCENTAGES = [4, 8, 10, 14] as const;

/** Cap of a custom tip, in ARS cents ($50.000). */
export const TIP_MAX_CENTS = 5_000_000;

/** Cap of "¿Con cuánto abonás?", in ARS cents ($10.000.000). */
export const CASH_TENDERED_MAX_CENTS = 1_000_000_000;

export const TIP_MESSAGES = {
  onlyDeliveryTransfer: "La propina solo se puede dejar en pedidos con envío pagados por transferencia o divididos.",
  invalidAmount: "La propina tiene que ser un monto entero en pesos, de $0 a $50.000",
} as const;

export const PAYMENT_SPLIT_MESSAGES = {
  splitRequired: "Ingresá cuánto pagás en efectivo",
  splitInvalid: "Tiene que ser un monto entero en pesos",
  splitRange: "Tiene que ser mayor a $0 y menor al total del pedido",
  splitCoversTip: "La propina va por transferencia: el efectivo tiene que ser menor al total sin la propina",
  tenderedInvalid: "Tiene que ser un monto entero en pesos",
  tenderedTooHigh: "El monto máximo es $10.000.000",
  tenderedTooLow: "Tiene que ser igual o mayor a lo que pagás en efectivo",
  splitNeedsBoth: "Para dividir el pago necesitás Efectivo y Transferencia habilitados",
} as const;

/**
 * Tip of `percent` over the products subtotal, rounded to whole pesos (a multiple of 100 cents).
 * The diner picks a percentage but only the amount travels to the API.
 */
export function tipFromPercent(subtotalCents: number, percent: number): number {
  return Math.round((subtotalCents * percent) / 10_000) * 100;
}

/** A tip only exists on delivery orders paid by transfer or split. */
export function canHaveTip(fulfillment: Fulfillment, paymentMethod: PaymentMethod): boolean {
  return fulfillment === "delivery" && (paymentMethod === "transfer" || paymentMethod === "split");
}

/** How much of an order goes in cash and how much by transfer, with the change. */
export interface PaymentBreakdown {
  cashCents: number;
  transferCents: number;
  /** "¿Con cuánto abonás?", or `null` when the diner left it empty (or paid by transfer). */
  tenderedCents: number | null;
  /** `tenderedCents - cashCents`, or `null` when there is no tendered amount. */
  changeCents: number | null;
}

export interface PaymentBreakdownInput {
  totalCents: number;
  paymentMethod: PaymentMethod;
  splitCashCents?: number | null;
  cashTenderedCents?: number | null;
}

/**
 * Checks the cash part of a `split` order. The tip always travels in the transfer part, so the cash
 * must stay below `total - tip` (the transfer then covers the whole tip plus part of the order).
 * Returns the message key to show, or `null` when the amount is valid.
 */
export function splitCashProblem(
  splitCashCents: number,
  totalCents: number,
  tipCents = 0,
): "splitRange" | "splitCoversTip" | null {
  if (splitCashCents <= 0 || splitCashCents >= totalCents) return "splitRange";
  if (splitCashCents >= totalCents - tipCents) return "splitCoversTip";
  return null;
}

/** Splits the total of any order: all cash, all transfer, or the diner's cash part. */
export function paymentBreakdown(order: PaymentBreakdownInput): PaymentBreakdown {
  const total = Math.max(0, Math.round(order.totalCents));
  const cashCents =
    order.paymentMethod === "cash"
      ? total
      : order.paymentMethod === "split"
        ? Math.min(total, Math.max(0, Math.round(order.splitCashCents ?? 0)))
        : 0;
  const tenderedCents =
    order.paymentMethod === "transfer" || order.cashTenderedCents == null
      ? null
      : Math.round(order.cashTenderedCents);
  return {
    cashCents,
    transferCents: total - cashCents,
    tenderedCents,
    changeCents: tenderedCents === null ? null : Math.max(0, tenderedCents - cashCents),
  };
}

export interface OrderTotalsInput {
  subtotalCents: number;
  shippingCents: number;
  tipCents?: number;
  fulfillment: Fulfillment;
}

export interface OrderTotals {
  subtotalCents: number;
  shippingCents: number;
  tipCents: number;
  totalCents: number;
}

export function orderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotal = Math.round(input.subtotalCents);
  const shipping = input.fulfillment === "delivery" ? Math.max(0, Math.round(input.shippingCents)) : 0;
  // A takeaway order has neither shipping nor courier, so no tip either.
  const tip = input.fulfillment === "delivery" ? Math.max(0, Math.round(input.tipCents ?? 0)) : 0;
  return {
    subtotalCents: subtotal,
    shippingCents: shipping,
    tipCents: tip,
    totalCents: subtotal + shipping + tip,
  };
}

export const ORDER_THROTTLE = { maxOrders: 3, windowMs: 600000 } as const;
export const ORDER_BODY_MAX_BYTES = 16384;

export const ORDER_MAX_LINES = 30;
export const ORDER_LINE_QUANTITY_MIN = 1;
export const ORDER_LINE_QUANTITY_MAX = 20;
export const ORDER_ITEM_CHOICES_MAX = 20;

export const ORDERS_MESSAGES = {
  itemsEmpty: "El pedido debe tener al menos un producto",
  itemsTooMany: `El pedido puede tener hasta ${ORDER_MAX_LINES} productos distintos`,
  quantityInvalid: `Las unidades deben ser un número entero entre ${ORDER_LINE_QUANTITY_MIN} y ${ORDER_LINE_QUANTITY_MAX}`,
  choicesTooMany: `Hasta ${ORDER_ITEM_CHOICES_MAX} ingredientes por producto`,
  nameRequired: ORDER_MESSAGES.nameRequired,
  nameTooLong: ORDER_MESSAGES.nameTooLong,
  phoneRequired: "Ingresá tu teléfono",
  phoneInvalid: "Número inválido. Incluí el código de área, por ejemplo 11 1234-5678.",
  addressRequired: ORDER_MESSAGES.addressRequired,
  addressTooLong: ORDER_MESSAGES.addressTooLong,
  fulfillmentInvalid: "Modalidad de entrega inválida",
  paymentMethodInvalid: "Forma de pago inválida",
  clientOrderIdInvalid: "El identificador del pedido debe ser un UUID válido",
  expectedTotalInvalid: "El total esperado debe ser un número entero no negativo",
  manualSourceInvalid: "Elegí el origen del pedido",
  notesTooLong: `El comentario puede tener hasta ${ORDER_NOTES_MAX_LENGTH} caracteres`,
} as const;

export const createOrderItemChoiceSchema = z
  .record(z.string(), z.number().int())
  .refine(
    (choices) => Object.keys(choices).length <= ORDER_ITEM_CHOICES_MAX,
    ORDERS_MESSAGES.choicesTooMany
  )
  .default({});

export const createOrderItemSchema = z.object({
  productId: z.string().min(1, "El producto es obligatorio"),
  quantity: z
    .number()
    .int(ORDERS_MESSAGES.quantityInvalid)
    .min(ORDER_LINE_QUANTITY_MIN, ORDERS_MESSAGES.quantityInvalid)
    .max(ORDER_LINE_QUANTITY_MAX, ORDERS_MESSAGES.quantityInvalid),
  choices: createOrderItemChoiceSchema.optional().default({}),
});

export const createOrderCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, ORDERS_MESSAGES.nameRequired)
    .max(ORDER_NAME_MAX_LENGTH, ORDERS_MESSAGES.nameTooLong),
  phone: z
    .string()
    .trim()
    .min(1, ORDERS_MESSAGES.phoneRequired)
    .transform((val, ctx) => {
      const normalized = normalizeArWhatsapp(val);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: ORDERS_MESSAGES.phoneInvalid,
        });
        return z.NEVER;
      }
      return normalized;
    }),
  address: z
    .string()
    .trim()
    .max(ORDER_ADDRESS_MAX_LENGTH, ORDERS_MESSAGES.addressTooLong)
    .nullable()
    .optional(),
});

const splitCashField = z
  .number(PAYMENT_SPLIT_MESSAGES.splitInvalid)
  .int(PAYMENT_SPLIT_MESSAGES.splitInvalid)
  .min(0, PAYMENT_SPLIT_MESSAGES.splitInvalid)
  .optional();

const cashTenderedField = z
  .number(PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
  .int(PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
  .min(0, PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
  .max(CASH_TENDERED_MAX_CENTS, PAYMENT_SPLIT_MESSAGES.tenderedTooHigh)
  .optional();

const tipField = z
  .number(TIP_MESSAGES.invalidAmount)
  .int(TIP_MESSAGES.invalidAmount)
  .min(0, TIP_MESSAGES.invalidAmount)
  .max(TIP_MAX_CENTS, TIP_MESSAGES.invalidAmount)
  .multipleOf(100, TIP_MESSAGES.invalidAmount)
  .optional()
  .default(0);

/** The fields both order-creation paths validate the same way (public and manual). */
interface OrderChargeValues {
  paymentMethod: PaymentMethod;
  expectedTotalCents: number;
  splitCashCents?: number;
  cashTenderedCents?: number;
  tipCents: number;
  fulfillment: Fulfillment;
}

/**
 * Validates split, cash tendered and tip against the total the client expects; returns the two values
 * already normalized to `null` when they do not apply. `null` means an issue was added.
 */
function normalizeOrderCharges<T extends OrderChargeValues>(
  value: T,
  ctx: z.RefinementCtx,
): { splitCashCents: number | null; cashTenderedCents: number | null } | null {
  // The split and the cash tendered are validated against the expected total; the service repeats
  // the split check against its own recalculated total.
  const splitCashCents = value.paymentMethod === "split" ? (value.splitCashCents ?? null) : null;
  if (value.paymentMethod === "split") {
    if (typeof splitCashCents !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PAYMENT_SPLIT_MESSAGES.splitRequired,
        path: ["splitCashCents"],
      });
      return null;
    }
    const splitProblem = splitCashProblem(splitCashCents, value.expectedTotalCents, value.tipCents);
    if (splitProblem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PAYMENT_SPLIT_MESSAGES[splitProblem],
        path: ["splitCashCents"],
      });
      return null;
    }
  }
  const cashTenderedCents = value.paymentMethod === "transfer" ? null : (value.cashTenderedCents ?? null);
  if (cashTenderedCents !== null) {
    const cashCents = value.paymentMethod === "cash" ? value.expectedTotalCents : (splitCashCents ?? 0);
    if (cashTenderedCents < cashCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: PAYMENT_SPLIT_MESSAGES.tenderedTooLow,
        path: ["cashTenderedCents"],
      });
      return null;
    }
  }

  // No client HTTP is trusted: a tip on takeaway or cash is rejected even if the front never sent it.
  if (value.tipCents > 0 && !canHaveTip(value.fulfillment, value.paymentMethod)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: TIP_MESSAGES.onlyDeliveryTransfer,
      path: ["tipCents"],
    });
    return null;
  }

  return { splitCashCents, cashTenderedCents };
}

export const createOrderRequestSchema = z
  .object({
    items: z
      .array(createOrderItemSchema)
      .min(1, ORDERS_MESSAGES.itemsEmpty)
      .max(ORDER_MAX_LINES, ORDERS_MESSAGES.itemsTooMany),
    customer: createOrderCustomerSchema,
    fulfillment: z.enum(FULFILLMENTS, {
      message: ORDERS_MESSAGES.fulfillmentInvalid,
    }),
    paymentMethod: z.enum(PAYMENT_METHODS, {
      message: ORDERS_MESSAGES.paymentMethodInvalid,
    }),
    /** Cash part of a `split` order, in ARS cents. */
    splitCashCents: splitCashField,
    /** "¿Con cuánto abonás?", in ARS cents; optional even on cash and split. */
    cashTenderedCents: cashTenderedField,
    clientOrderId: z.string().uuid(ORDERS_MESSAGES.clientOrderIdInvalid),
    expectedTotalCents: z
      .number()
      .int(ORDERS_MESSAGES.expectedTotalInvalid)
      .min(0, ORDERS_MESSAGES.expectedTotalInvalid),
    /**
     * Courier tip in ARS cents, already rounded to whole pesos by the diner's front. Optional; `0`
     * when absent. Only valid on a delivery order paid by transfer or split (`canHaveTip`).
     */
    tipCents: tipField,
    /**
     * The geocoded address, required by stores in `zones` mode (the service checks it, since the
     * schema does not know the mode). `flat` stores ignore it and use `customer.address`.
     */
    delivery: orderDeliverySchema.nullish(),
  })
  .transform((val, ctx) => {
    const charges = normalizeOrderCharges(val, ctx);
    if (!charges) return z.NEVER;
    const { splitCashCents, cashTenderedCents } = charges;

    if (val.fulfillment === "delivery") {
      const addr = val.customer.address?.trim() ?? "";
      const delivery = val.delivery ?? null;
      // A geocoded address stands in for the typed one.
      if (addr.length === 0 && !delivery) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: ORDERS_MESSAGES.addressRequired,
          path: ["customer", "address"],
        });
        return z.NEVER;
      }
      return {
        ...val,
        splitCashCents,
        cashTenderedCents,
        customer: {
          ...val.customer,
          address: addr || null,
        },
        delivery,
      };
    } else {
      return {
        ...val,
        splitCashCents,
        cashTenderedCents,
        customer: {
          ...val.customer,
          address: null,
        },
        delivery: null,
      };
    }
  });

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/**
 * What a client sends: `tipCents` may be absent (the schema defaults it to 0). The web front omits it
 * on cash and takeaway orders, so the tip never travels outside a delivery paid by transfer.
 */
export type CreateOrderRequestInput = z.input<typeof createOrderRequestSchema>;

/** Customer of a manually created order: the phone is optional unless the source is WhatsApp. */
export const createManualOrderCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, ORDERS_MESSAGES.nameRequired)
    .max(ORDER_NAME_MAX_LENGTH, ORDERS_MESSAGES.nameTooLong),
  phone: z
    .string()
    .trim()
    .nullish()
    .transform((val, ctx) => {
      const trimmed = val?.trim() ?? "";
      if (trimmed === "") return "";
      const normalized = normalizeArWhatsapp(trimmed);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: ORDERS_MESSAGES.phoneInvalid });
        return z.NEVER;
      }
      return normalized;
    }),
  address: z
    .string()
    .trim()
    .max(ORDER_ADDRESS_MAX_LENGTH, ORDERS_MESSAGES.addressTooLong)
    .nullable()
    .optional(),
});

/** Body of `POST /api/orders`: an order loaded by an employee, with its source and optional comment. */
export const createManualOrderRequestSchema = z
  .object({
    items: z
      .array(createOrderItemSchema)
      .min(1, ORDERS_MESSAGES.itemsEmpty)
      .max(ORDER_MAX_LINES, ORDERS_MESSAGES.itemsTooMany),
    customer: createManualOrderCustomerSchema,
    fulfillment: z.enum(FULFILLMENTS, { message: ORDERS_MESSAGES.fulfillmentInvalid }),
    paymentMethod: z.enum(PAYMENT_METHODS, { message: ORDERS_MESSAGES.paymentMethodInvalid }),
    splitCashCents: splitCashField,
    cashTenderedCents: cashTenderedField,
    source: z.enum(MANUAL_ORDER_SOURCES, { message: ORDERS_MESSAGES.manualSourceInvalid }),
    notes: z
      .string()
      .trim()
      .max(ORDER_NOTES_MAX_LENGTH, ORDERS_MESSAGES.notesTooLong)
      .nullish()
      .transform((value) => (value ? value : null)),
    markPaid: z.boolean().default(false),
    clientOrderId: z.string().uuid(ORDERS_MESSAGES.clientOrderIdInvalid),
    expectedTotalCents: z
      .number()
      .int(ORDERS_MESSAGES.expectedTotalInvalid)
      .min(0, ORDERS_MESSAGES.expectedTotalInvalid),
    tipCents: tipField,
    delivery: orderDeliverySchema.nullish(),
  })
  .transform((val, ctx) => {
    const charges = normalizeOrderCharges(val, ctx);
    if (!charges) return z.NEVER;
    const { splitCashCents, cashTenderedCents } = charges;

    if (val.source === "whatsapp" && val.customer.phone === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: ORDERS_MESSAGES.phoneRequired,
        path: ["customer", "phone"],
      });
      return z.NEVER;
    }

    if (val.fulfillment === "delivery") {
      const addr = val.customer.address?.trim() ?? "";
      const delivery = val.delivery ?? null;
      if (addr.length === 0 && !delivery) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: ORDERS_MESSAGES.addressRequired,
          path: ["customer", "address"],
        });
        return z.NEVER;
      }
      return {
        ...val,
        splitCashCents,
        cashTenderedCents,
        customer: { ...val.customer, address: addr || null },
        delivery,
      };
    }

    return {
      ...val,
      splitCashCents,
      cashTenderedCents,
      customer: { ...val.customer, address: null },
      delivery: null,
    };
  });

export type CreateManualOrderRequest = z.infer<typeof createManualOrderRequestSchema>;
export type CreateManualOrderRequestInput = z.input<typeof createManualOrderRequestSchema>;

/** What `POST /api/orders` answers: the stored order and, if marking it paid failed, why. */
export interface CreateManualOrderResponse extends OrderDetail {
  paymentError?: string;
}

/** Most orders one CSV export may contain; a larger result asks the owner to narrow the dates. */
export const ORDER_EXPORT_MAX = 5000;

/** Status filter of the owner's order list: a single status, or `active` (new, preparing, ready or sent). */
export const ORDER_STATUS_FILTERS = [...ORDER_STATUSES, "active"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

/**
 * Timestamp that `from` and `to` filter on: when the order was created (default; history and CSV),
 * when it was last updated, or when it was delivered. "Entregados" of the board uses `delivered`.
 */
export const ORDER_DATE_FIELDS = ["created", "updated", "delivered"] as const;
export type OrderDateField = (typeof ORDER_DATE_FIELDS)[number];

export const ORDER_FILTER_MESSAGES = {
  statusInvalid: "Estado inválido",
  dateFieldInvalid: "Campo de fecha inválido",
  fulfillmentInvalid: "Modalidad inválida",
  paymentMethodInvalid: "Forma de pago inválida",
  paymentStatusInvalid: "Estado de pago inválido",
  settledInvalid: "Valor inválido, usá true o false",
  fromInvalid: "Fecha desde inválida",
  toInvalid: "Fecha hasta inválida",
  rangeInvalid: "Rango de fechas inválido",
  limitInvalid: "Límite inválido",
  beforeInvalid: "Cursor inválido",
} as const;

/** Query parameters arrive as strings and an empty one means "no filter". */
function optionalParam<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

const dateKeyParam = (message: string) => optionalParam(z.string().refine(isCalendarDateKey, message));
const positiveIntParam = (message: string) => optionalParam(z.coerce.number(message).int(message).positive(message));
const flagParam = optionalParam(
  z.enum(["true", "false"], ORDER_FILTER_MESSAGES.settledInvalid).transform((value) => value === "true"),
);

/**
 * Query of the owner's order list and CSV export. `from` and `to` are local calendar days
 * (YYYY-MM-DD, both inclusive); `before` is the order number cursor of the next page.
 */
export const orderFiltersQuerySchema = z
  .object({
    status: optionalParam(z.enum(ORDER_STATUS_FILTERS, ORDER_FILTER_MESSAGES.statusInvalid)),
    fulfillment: optionalParam(z.enum(FULFILLMENTS, ORDER_FILTER_MESSAGES.fulfillmentInvalid)),
    paymentMethod: optionalParam(z.enum(PAYMENT_METHODS, ORDER_FILTER_MESSAGES.paymentMethodInvalid)),
    paymentStatus: optionalParam(z.enum(PAYMENT_STATUSES, ORDER_FILTER_MESSAGES.paymentStatusInvalid)),
    cashSessionId: optionalParam(z.string().min(1, ORDER_FILTER_MESSAGES.statusInvalid)),
    settled: flagParam,
    from: dateKeyParam(ORDER_FILTER_MESSAGES.fromInvalid),
    to: dateKeyParam(ORDER_FILTER_MESSAGES.toInvalid),
    dateField: optionalParam(z.enum(ORDER_DATE_FIELDS, ORDER_FILTER_MESSAGES.dateFieldInvalid)),
    limit: positiveIntParam(ORDER_FILTER_MESSAGES.limitInvalid),
    before: positiveIntParam(ORDER_FILTER_MESSAGES.beforeInvalid),
  })
  // YYYY-MM-DD keys compare chronologically as strings.
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: ORDER_FILTER_MESSAGES.rangeInvalid,
    path: ["to"],
  });

export type OrderFiltersQuery = z.infer<typeof orderFiltersQuerySchema>;

export const COURIER_MESSAGES = {
  assignRequired: "Elegí un repartidor",
  invalidCourier: "Elegí un repartidor de tu local",
} as const;

/** Body of `POST /api/orders/:id/assign`. */
export const assignCourierSchema = z.object({
  courierMemberId: z
    .string(COURIER_MESSAGES.assignRequired)
    .trim()
    .min(1, COURIER_MESSAGES.assignRequired),
});

export type AssignCourierInput = z.infer<typeof assignCourierSchema>;

/** Body of `PATCH /api/orders/:id/payment-method`. */
export const updateOrderPaymentMethodSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS, { message: ORDERS_MESSAGES.paymentMethodInvalid }),
  splitCashCents: z
    .number(PAYMENT_SPLIT_MESSAGES.splitInvalid)
    .int(PAYMENT_SPLIT_MESSAGES.splitInvalid)
    .min(0, PAYMENT_SPLIT_MESSAGES.splitInvalid)
    .nullable()
    .optional(),
  cashTenderedCents: z
    .number(PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
    .int(PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
    .min(0, PAYMENT_SPLIT_MESSAGES.tenderedInvalid)
    .max(CASH_TENDERED_MAX_CENTS, PAYMENT_SPLIT_MESSAGES.tenderedTooHigh)
    .nullable()
    .optional(),
  expectedStatus: z.enum(ORDER_STATUSES, "Estado desconocido"),
});

export type UpdateOrderPaymentMethodInput = z.infer<typeof updateOrderPaymentMethodSchema>;

const dateRangeFields = {
  from: dateKeyParam(ORDER_FILTER_MESSAGES.fromInvalid),
  to: dateKeyParam(ORDER_FILTER_MESSAGES.toInvalid),
};

const inDateOrder = (query: { from?: string; to?: string }) => !query.from || !query.to || query.from <= query.to;

/** Query of the summaries: local calendar days, both inclusive; absent means "today". */
export const dateRangeQuerySchema = z
  .object(dateRangeFields)
  .refine(inDateOrder, { message: ORDER_FILTER_MESSAGES.rangeInvalid, path: ["to"] });

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

/**
 * Status filter of the courier summary: delivered orders (by `delivered_at`), orders on the way
 * (`sent`, by `sent_at`) or both. Cancelled orders never count.
 */
export const COURIER_SUMMARY_STATUSES = ["delivered", "sent", "all"] as const;
export type CourierSummaryStatus = (typeof COURIER_SUMMARY_STATUSES)[number];

export const COURIER_SUMMARY_STATUS_LABELS: Record<CourierSummaryStatus, string> = {
  delivered: "Entregados",
  sent: "En camino",
  all: "Todos",
};

/** Query of the courier summary: the range, a status and an optional courier of the local. */
export const courierSummaryQuerySchema = z
  .object({
    ...dateRangeFields,
    status: optionalParam(z.enum(COURIER_SUMMARY_STATUSES, "Elegí un estado: entregados, en camino o todos")).default(
      "delivered",
    ),
    courierMemberId: optionalParam(z.string(COURIER_MESSAGES.invalidCourier).min(1, COURIER_MESSAGES.invalidCourier)),
  })
  .refine(inDateOrder, { message: ORDER_FILTER_MESSAGES.rangeInvalid, path: ["to"] });

export type CourierSummaryQuery = z.infer<typeof courierSummaryQuerySchema>;

export interface OrderItemOption {
  name: string;
  quantity: number;
  includedQty: number;
  extraPriceCents: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  position: number;
  name: string;
  unitPriceCents: number;
  quantity: number;
  options: OrderItemOption[] | null;
  notes: string | null;
}

/** Courier of an order as the owner and the courier himself see it. */
export interface OrderCourier {
  memberId: string;
  firstName: string;
  lastName: string;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  /** Cash part of a `split` order; `null` on cash and transfer. */
  splitCashCents: number | null;
  /** "¿Con cuánto abonás?"; `null` when the diner left it empty. */
  cashTenderedCents: number | null;
  /** The order's total split into cash and transfer, with the change. */
  paymentBreakdown: PaymentBreakdown;
  /** When it was marked paid; `null` for orders older than 0014 or not paid yet. */
  paidAt: number | null;
  /** Cash session it entered; `null` when it was paid without an open cash. */
  cashSessionId: string | null;
  /** When "Ingresar a la caja" was used; `null` for orders not delivered in cash. */
  settledAt: number | null;
  customerName: string;
  customerPhone: string;
  /** Where the order came from: the public menu, the counter or WhatsApp. */
  source: OrderSource;
  /** Comment of the order; `null` when the employee left none. */
  notes: string | null;
  totalCents: number;
  itemCount: number;
  createdAt: number;
  /** Assigned courier, or `null` when the order has none (takeaway, not sent yet or older orders). */
  courier: OrderCourier | null;
  /** Map point of a geocoded delivery order (the orders map); `null` like the detail's `deliveryLocation`. */
  deliveryLocation: OrderMapPoint | null;
}

/** The part of `OrderDeliveryLocation` the owner's order list carries. */
export type OrderMapPoint = Pick<OrderDeliveryLocation, "lat" | "lng" | "zoneName">;

export interface OrderPaymentInfo {
  alias: string | null;
  holderName: string | null;
}

/**
 * Where a delivery order goes, as geocoded by the diner (stores in `zones` mode). Only the owner sees
 * it: the public order carries just `deliveryAddress`.
 */
export interface OrderDeliveryLocation {
  lat: number;
  lng: number;
  placeId: string | null;
  /** Floor, apartment or any note about the door. */
  unit: string | null;
  betweenStreets: string | null;
  /** How the diner tagged the address (Casa, Trabajo, Otra). */
  label: AddressLabel | null;
  /** Name of the zone that priced the shipping when the order was placed. */
  zoneName: string | null;
  /** Straight-line distance from the store, in meters. */
  distanceM: number | null;
}

export interface OrderDetail {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  /** Cash part of a `split` order; `null` on cash and transfer. */
  splitCashCents: number | null;
  /** "¿Con cuánto abonás?"; `null` when the diner left it empty. */
  cashTenderedCents: number | null;
  /** The order's total split into cash and transfer, with the change. */
  paymentBreakdown: PaymentBreakdown;
  customerName: string;
  customerPhone: string;
  /** Where the order came from: the public menu, the counter or WhatsApp. */
  source: OrderSource;
  deliveryAddress: string | null;
  /** `null` for takeaway, `flat` stores and orders placed before delivery zones. */
  deliveryLocation: OrderDeliveryLocation | null;
  notes: string | null;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  /** Courier tip, kept apart from the subtotal and the shipping; `0` when there is none. */
  tipCents: number;
  totalCents: number;
  items: OrderItem[];
  createdAt: number;
  updatedAt: number;
  /** Courier who took the order; `null` for takeaway, not sent yet and orders older than 0012. */
  courier: OrderCourier | null;
  /** Exact time the order went out, or `null` when it never did. */
  sentAt: number | null;
  /** Exact time the order was delivered, or `null` when it was not. */
  deliveredAt: number | null;
  /** When it was marked paid; `null` for orders older than 0014 or not paid yet. */
  paidAt: number | null;
  /** Cash session it entered; `null` when it was paid without an open cash. */
  cashSessionId: string | null;
  /** When "Ingresar a la caja" was used; `null` for orders not delivered in cash. */
  settledAt: number | null;
  payment?: OrderPaymentInfo | null;
}

/** One order of "Mis repartos": what the courier needs to deliver it. */
export interface CourierDelivery {
  id: string;
  number: number;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  deliveryLocation: OrderDeliveryLocation | null;
  notes: string | null;
  paymentMethod: PaymentMethod;
  /** Cash part of a `split` order; `null` on cash and transfer. */
  splitCashCents: number | null;
  /** "¿Con cuánto abonás?"; `null` when the diner left it empty. */
  cashTenderedCents: number | null;
  /** The order's total split into cash and transfer, with the change. */
  paymentBreakdown: PaymentBreakdown;
  totalCents: number;
  shippingCents: number;
  tipCents: number;
  sentAt: number | null;
}

/** Totals of the orders a courier delivered in a range. */
export interface DeliverySummary {
  from: string;
  to: string;
  delivered: number;
  shippingCents: number;
  tipCents: number;
}

/** Active courier of the local, with the orders it currently has on the way. */
export interface CourierOption {
  memberId: string;
  firstName: string;
  lastName: string;
  /** Orders currently `sent` assigned to this courier. */
  inProgressOrders: number;
}

/** Courier of the local in the filter of "Repartidores": there even when the range has no deliveries. */
export interface CourierFilterOption {
  memberId: string;
  firstName: string;
  lastName: string;
  active: boolean;
}

/** One row of the courier summary: a courier of the local, or "Sin repartidor" (`memberId: null`). */
export interface CourierSummaryRow {
  memberId: string | null;
  firstName: string | null;
  lastName: string | null;
  /** `null` for "Sin repartidor"; `false` for a courier the owner deactivated (the design's "Inactivo"). */
  active: boolean | null;
  delivered: number;
  /** Orders still on the way (`sent`); always 0 with the "delivered" status filter. */
  inProgress: number;
  shippingCents: number;
  tipCents: number;
}

export interface CourierSummary {
  from: string;
  to: string;
  /** Every courier of the local (active or not): the options of the page's filter (scenario 48). */
  couriers: CourierFilterOption[];
  rows: CourierSummaryRow[];
  totals: Pick<CourierSummaryRow, "delivered" | "inProgress" | "shippingCents" | "tipCents">;
}

/** Item of the order as the customer sees it: no ids, no internal fields. */
export interface PublicOrderItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  options: OrderItemOption[] | null;
}

/** Order as returned to the customer who placed it (scenario 14: no ids, no internal state). */
export interface PublicOrder {
  number: number;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  splitCashCents: number | null;
  cashTenderedCents: number | null;
  paymentBreakdown: PaymentBreakdown;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  items: PublicOrderItem[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  /** Courier tip of the order; `0` when the diner left none. */
  tipCents: number;
  totalCents: number;
}

export function toPublicOrder(order: OrderDetail): PublicOrder {
  return {
    number: order.number,
    fulfillment: order.fulfillment,
    paymentMethod: order.paymentMethod,
    splitCashCents: order.splitCashCents,
    cashTenderedCents: order.cashTenderedCents,
    paymentBreakdown: order.paymentBreakdown,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      options: item.options,
    })),
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: order.discountCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
  };
}

export interface CreateOrderResponse {
  order: PublicOrder;
  whatsappUrl: string;
  payment: OrderPaymentInfo | null;
}

export function describeOrderOptions(options: readonly OrderItemOption[] | null | undefined): string[] {
  if (!options || options.length === 0) return [];
  const descriptions: string[] = [];
  for (const opt of options) {
    if (opt.quantity === 0) {
      descriptions.push(`Sin ${opt.name.toLowerCase()}`);
    } else if (opt.quantity > opt.includedQty) {
      const extraCents = (opt.quantity - opt.includedQty) * opt.extraPriceCents;
      const extraStr = extraCents > 0 ? ` (+${formatArs(extraCents)})` : "";
      descriptions.push(`${opt.name} x${opt.quantity}${extraStr}`);
    } else {
      descriptions.push(`${opt.name} x${opt.quantity}`);
    }
  }
  return descriptions;
}

export interface BuildOrderMessageOptions {
  restaurantName?: string;
  payment?: OrderPaymentInfo | null;
}

export interface BuildOrderMessageItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  options?: readonly OrderItemOption[] | null;
}

export function buildOrderMessage(
  order: {
    number: number;
    subtotalCents: number;
    shippingCents: number;
    tipCents?: number;
    totalCents: number;
    fulfillment: Fulfillment;
    paymentMethod: PaymentMethod;
    splitCashCents?: number | null;
    cashTenderedCents?: number | null;
    customerName: string;
    customerPhone: string;
    deliveryAddress?: string | null;
    items: readonly BuildOrderMessageItem[];
    payment?: OrderPaymentInfo | null;
  },
  options?: BuildOrderMessageOptions
): string {
  const lines: string[] = [];
  lines.push(`Hola! Quiero hacer el pedido #${order.number}:`);
  lines.push("");

  for (const item of order.items) {
    const lineTotal = item.unitPriceCents * item.quantity;
    lines.push(`${item.quantity}x ${item.name} (${formatArs(lineTotal)})`);
    if (item.options && item.options.length > 0) {
      for (const opt of describeOrderOptions(item.options)) {
        lines.push(`   - ${opt}`);
      }
    }
  }

  lines.push("");
  lines.push(`Subtotal: ${formatArs(order.subtotalCents)}`);
  if (order.fulfillment === "delivery") {
    const shippingText = order.shippingCents > 0 ? formatArs(order.shippingCents) : "Envío gratis";
    lines.push(`Envío: ${shippingText}`);
  }
  if (order.tipCents && order.tipCents > 0) {
    lines.push(`Propina para el repartidor: ${formatArs(order.tipCents)}`);
  }
  lines.push(`Total: ${formatArs(order.totalCents)}`);
  lines.push("");

  if (order.fulfillment === "delivery") {
    lines.push(`Envío a: ${order.deliveryAddress ?? ""}`);
  } else {
    lines.push("Retiro en el local");
  }

  const paymentInfo = options?.payment ?? order.payment;
  const breakdown = paymentBreakdown(order);
  const tendered =
    breakdown.tenderedCents === null
      ? ""
      : ` (abona con ${formatArs(breakdown.tenderedCents)}, vuelto ${formatArs(breakdown.changeCents ?? 0)})`;
  if (order.paymentMethod === "cash") {
    lines.push(`Pago: Efectivo${tendered}`);
  } else if (order.paymentMethod === "split") {
    lines.push(
      `Pago: Dividir pago — Efectivo ${formatArs(breakdown.cashCents)}${tendered} + Transferencia ${formatArs(breakdown.transferCents)}`,
    );
  } else {
    if (paymentInfo?.alias && paymentInfo?.holderName) {
      lines.push(`Pago: Transferencia (alias ${paymentInfo.alias}, titular ${paymentInfo.holderName})`);
    } else if (paymentInfo?.alias) {
      lines.push(`Pago: Transferencia (alias ${paymentInfo.alias})`);
    } else {
      lines.push("Pago: Transferencia");
    }
  }

  lines.push(`Nombre: ${order.customerName}`);
  lines.push(`Teléfono: ${order.customerPhone}`);

  return lines.join("\n");
}
