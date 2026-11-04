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
import { normalizeArWhatsapp } from "./restaurant";
import { isCalendarDateKey } from "./time";

export const ORDER_STATUSES = ["new", "preparing", "ready", "sent", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

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

export interface OrderTotalsInput {
  subtotalCents: number;
  shippingCents: number;
  fulfillment: Fulfillment;
}

export interface OrderTotals {
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

export function orderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotal = Math.round(input.subtotalCents);
  const shipping = input.fulfillment === "delivery" ? Math.max(0, Math.round(input.shippingCents)) : 0;
  return {
    subtotalCents: subtotal,
    shippingCents: shipping,
    totalCents: subtotal + shipping,
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
    clientOrderId: z.string().uuid(ORDERS_MESSAGES.clientOrderIdInvalid),
    expectedTotalCents: z
      .number()
      .int(ORDERS_MESSAGES.expectedTotalInvalid)
      .min(0, ORDERS_MESSAGES.expectedTotalInvalid),
  })
  .transform((val, ctx) => {
    if (val.fulfillment === "delivery") {
      const addr = val.customer.address?.trim() ?? "";
      if (addr.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: ORDERS_MESSAGES.addressRequired,
          path: ["customer", "address"],
        });
        return z.NEVER;
      }
      return {
        ...val,
        customer: {
          ...val.customer,
          address: addr,
        },
      };
    } else {
      return {
        ...val,
        customer: {
          ...val.customer,
          address: null,
        },
      };
    }
  });

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/** Most orders one CSV export may contain; a larger result asks the owner to narrow the dates. */
export const ORDER_EXPORT_MAX = 5000;

/** Status filter of the owner's order list: a single status, or `active` (new, preparing, ready or sent). */
export const ORDER_STATUS_FILTERS = [...ORDER_STATUSES, "active"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

/**
 * Timestamp that `from` and `to` filter on: when the order was created (default; history and CSV)
 * or last updated. "Entregados" of the board uses `updated` as an approximation of the delivery
 * time: there is no `delivered_at` column, so a later change (the payment) also moves it.
 */
export const ORDER_DATE_FIELDS = ["created", "updated"] as const;
export type OrderDateField = (typeof ORDER_DATE_FIELDS)[number];

export const ORDER_FILTER_MESSAGES = {
  statusInvalid: "Estado inválido",
  dateFieldInvalid: "Campo de fecha inválido",
  fulfillmentInvalid: "Modalidad inválida",
  paymentMethodInvalid: "Forma de pago inválida",
  paymentStatusInvalid: "Estado de pago inválido",
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

export interface OrderSummary {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  totalCents: number;
  itemCount: number;
  createdAt: number;
}

export interface OrderPaymentInfo {
  alias: string | null;
  holderName: string | null;
}

export interface OrderDetail {
  id: string;
  number: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillment: Fulfillment;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  notes: string | null;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  items: OrderItem[];
  createdAt: number;
  updatedAt: number;
  payment?: OrderPaymentInfo | null;
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
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  items: PublicOrderItem[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
}

export function toPublicOrder(order: OrderDetail): PublicOrder {
  return {
    number: order.number,
    fulfillment: order.fulfillment,
    paymentMethod: order.paymentMethod,
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
    totalCents: number;
    fulfillment: Fulfillment;
    paymentMethod: PaymentMethod;
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
  lines.push(`Total: ${formatArs(order.totalCents)}`);
  lines.push("");

  if (order.fulfillment === "delivery") {
    lines.push(`Envío a: ${order.deliveryAddress ?? ""}`);
  } else {
    lines.push("Retiro en el local");
  }

  const paymentInfo = options?.payment ?? order.payment;
  if (order.paymentMethod === "cash") {
    lines.push("Pago: Efectivo");
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
