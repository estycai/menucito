import { z } from "zod";

export const ORDER_NAME_MAX_LENGTH = 60;
export const ORDER_ADDRESS_MAX_LENGTH = 120;

export const FULFILLMENTS = ["takeaway", "delivery"] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

/** Fixed list until restaurants can configure their own payment methods. */
export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FULFILLMENT_LABELS: Readonly<Record<Fulfillment, string>> = { takeaway: "Retiro", delivery: "Envío" };
export const PAYMENT_LABELS: Readonly<Record<PaymentMethod, string>> = { cash: "Efectivo", transfer: "Transferencia" };

export const ORDER_MESSAGES = {
  nameRequired: "Ingresá tu nombre",
  nameTooLong: `El nombre puede tener hasta ${ORDER_NAME_MAX_LENGTH} caracteres`,
  fulfillmentRequired: "Elegí retiro o envío",
  addressRequired: "Ingresá la dirección de entrega",
  addressTooLong: `La dirección puede tener hasta ${ORDER_ADDRESS_MAX_LENGTH} caracteres`,
  paymentRequired: "Elegí la forma de pago",
} as const;

/**
 * What the diner fills in before sending the order. The address is only required for delivery; for
 * pickup it is ignored. Cross-field rules run even when other fields are invalid, so every error
 * shows at once.
 */
export const orderDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, ORDER_MESSAGES.nameRequired)
      .max(ORDER_NAME_MAX_LENGTH, ORDER_MESSAGES.nameTooLong),
    fulfillment: z.enum(FULFILLMENTS, ORDER_MESSAGES.fulfillmentRequired),
    address: z.string().trim().max(ORDER_ADDRESS_MAX_LENGTH, ORDER_MESSAGES.addressTooLong),
    payment: z.enum(PAYMENT_METHODS, ORDER_MESSAGES.paymentRequired),
  })
  .refine((value) => value.fulfillment !== "delivery" || value.address.length > 0, {
    message: ORDER_MESSAGES.addressRequired,
    path: ["address"],
    // Skip when the fulfillment or the address are themselves invalid (the check would be noise).
    when: (payload) =>
      payload.issues.every((issue) => {
        const field = issue.path?.[0];
        return field !== undefined && field !== "fulfillment" && field !== "address";
      }),
  });

export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type OrderField = keyof OrderDetails;

/** First error message per field, or an empty object when the details are valid. */
export function orderDetailsErrors(input: unknown): Partial<Record<OrderField, string>> {
  const result = orderDetailsSchema.safeParse(input);
  if (result.success) return {};
  const errors: Partial<Record<OrderField, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) errors[field as OrderField] = issue.message;
  }
  return errors;
}
