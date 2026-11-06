import {
  FULFILLMENTS,
  MANUAL_ORDER_SOURCES,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_MESSAGES,
  ORDER_NAME_MAX_LENGTH,
  ORDER_NOTES_MAX_LENGTH,
  ORDERS_MESSAGES,
  normalizeArWhatsapp,
  type CreateManualOrderRequestInput,
  type Fulfillment,
  type ManualOrderSource,
  type OrderDelivery,
  type PaymentMethod,
} from "@menucito/shared";
import { z } from "zod";
import type { CartLine } from "@menucito/shared";

/** Fields of the "Detalles" step of "Nuevo pedido". */
export const newOrderDetailsSchema = z
  .object({
    fulfillment: z.enum(FULFILLMENTS, ORDER_MESSAGES.fulfillmentRequired),
    customerName: z
      .string()
      .trim()
      .min(1, ORDER_MESSAGES.nameRequired)
      .max(ORDER_NAME_MAX_LENGTH, ORDER_MESSAGES.nameTooLong),
    customerPhone: z.string().trim(),
    address: z.string().trim().max(ORDER_ADDRESS_MAX_LENGTH, ORDER_MESSAGES.addressTooLong),
    source: z.enum(MANUAL_ORDER_SOURCES, ORDERS_MESSAGES.manualSourceInvalid),
    notes: z.string().trim().max(ORDER_NOTES_MAX_LENGTH, ORDERS_MESSAGES.notesTooLong),
  })
  .superRefine((value, ctx) => {
    if (value.source === "whatsapp" && value.customerPhone === "") {
      ctx.addIssue({ code: "custom", message: ORDERS_MESSAGES.phoneRequired, path: ["customerPhone"] });
    } else if (value.customerPhone !== "" && !normalizeArWhatsapp(value.customerPhone)) {
      ctx.addIssue({ code: "custom", message: ORDERS_MESSAGES.phoneInvalid, path: ["customerPhone"] });
    }
    if (value.fulfillment === "delivery" && value.address === "") {
      ctx.addIssue({ code: "custom", message: ORDER_MESSAGES.addressRequired, path: ["address"] });
    }
  });

export type NewOrderDetails = z.infer<typeof newOrderDetailsSchema>;

/** Whole form of the popup: the details plus the payment choices of the second step. */
export interface NewOrderFormValues extends NewOrderDetails {
  paymentMethod: PaymentMethod;
  /** Pesos typed in "Pagás en efectivo" (split). */
  splitCash: string;
  /** Pesos typed in "¿Con cuánto abonás?". */
  cashTendered: string;
  /** Courier tip in ARS cents; only kept when `canHaveTip`. */
  tipCents: number;
  markPaid: boolean;
}

/** Whole pesos typed in a cash field, in cents: `undefined` empty, `null` invalid. */
export function pesosToCents(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 100;
}

export interface ManualOrderBodyInput {
  values: NewOrderFormValues;
  lines: readonly CartLine[];
  clientOrderId: string;
  delivery: OrderDelivery | null;
  totalCents: number;
  tipCents: number;
  splitCashCents: number | null;
  cashTenderedCents: number | null;
}

/** Body of `POST /api/orders` built from the form and the cart, without anything the API recomputes. */
export function buildManualOrderBody({
  values,
  lines,
  clientOrderId,
  delivery,
  totalCents,
  tipCents,
  splitCashCents,
  cashTenderedCents,
}: ManualOrderBodyInput): CreateManualOrderRequestInput {
  const notes = values.notes.trim();
  const phone = values.customerPhone.trim();
  const address = values.address.trim();
  return {
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      choices: line.choices,
    })),
    customer: {
      name: values.customerName.trim(),
      ...(phone ? { phone } : {}),
      ...(values.fulfillment === "delivery" || address ? { address: address || null } : {}),
    },
    fulfillment: values.fulfillment,
    paymentMethod: values.paymentMethod,
    ...(values.paymentMethod === "split" && splitCashCents !== null ? { splitCashCents } : {}),
    ...(values.paymentMethod !== "transfer" && cashTenderedCents !== null ? { cashTenderedCents } : {}),
    source: values.source,
    ...(notes ? { notes } : {}),
    markPaid: values.markPaid,
    clientOrderId,
    expectedTotalCents: totalCents,
    tipCents,
    ...(values.fulfillment === "delivery" && delivery ? { delivery } : {}),
  };
}

/** A close with products loaded loses the order, so it asks first (spec 15b, story 29). */
export function shouldConfirmClose(lines: readonly CartLine[]): boolean {
  return lines.length > 0;
}

/** Whether both fulfillments are offered; the popup opens with one of them. */
export function offeredFulfillments(delivery: boolean, takeaway: boolean): Fulfillment[] {
  return [...(delivery ? (["delivery"] as const) : []), ...(takeaway ? (["takeaway"] as const) : [])];
}

export type { ManualOrderSource };
