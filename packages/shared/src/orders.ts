import { z } from "zod";
import { formatArs } from "./catalog";
import { FULFILLMENTS, PAYMENT_METHODS, type Fulfillment, type PaymentMethod } from "./order";
import { normalizeArWhatsapp } from "./restaurant";

export const ORDER_STATUSES = ["new", "preparing", "ready", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES = ["new", "preparing", "ready"] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["pending", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  new: "Nuevo",
  preparing: "En preparación",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  pending: "Pendiente",
  paid: "Pagado",
};

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["preparing", "ready", "delivered", "cancelled"],
  preparing: ["ready", "delivered", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

export function nextStatus(from: OrderStatus): OrderStatus | null {
  switch (from) {
    case "new":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return "delivered";
    default:
      return null;
  }
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

export const ORDER_CUSTOMER_NAME_MAX_LENGTH = 60;
export const ORDER_CUSTOMER_ADDRESS_MAX_LENGTH = 120;
export const ORDER_MAX_LINES = 30;
export const ORDER_LINE_QUANTITY_MIN = 1;
export const ORDER_LINE_QUANTITY_MAX = 20;
export const ORDER_ITEM_CHOICES_MAX = 20;

export const ORDERS_MESSAGES = {
  itemsEmpty: "El pedido debe tener al menos un producto",
  itemsTooMany: `El pedido puede tener hasta ${ORDER_MAX_LINES} productos distintos`,
  quantityInvalid: `Las unidades deben ser un número entero entre ${ORDER_LINE_QUANTITY_MIN} y ${ORDER_LINE_QUANTITY_MAX}`,
  choicesTooMany: `Hasta ${ORDER_ITEM_CHOICES_MAX} ingredientes por producto`,
  nameRequired: "Ingresá tu nombre",
  nameTooLong: `El nombre puede tener hasta ${ORDER_CUSTOMER_NAME_MAX_LENGTH} caracteres`,
  phoneRequired: "Ingresá tu teléfono",
  phoneInvalid: "Número inválido. Incluí el código de área, por ejemplo 11 1234-5678.",
  addressRequired: "Ingresá la dirección de entrega",
  addressTooLong: `La dirección puede tener hasta ${ORDER_CUSTOMER_ADDRESS_MAX_LENGTH} caracteres`,
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
    .max(ORDER_CUSTOMER_NAME_MAX_LENGTH, ORDERS_MESSAGES.nameTooLong),
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
    .max(ORDER_CUSTOMER_ADDRESS_MAX_LENGTH, ORDERS_MESSAGES.addressTooLong)
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
