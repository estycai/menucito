import { z } from "zod";

/** Messages the store keeps for each status change, one set for delivery and one for takeaway. */
export const ORDER_MESSAGE_FULFILLMENTS = ["delivery", "takeaway"] as const;
export type OrderMessageFulfillment = (typeof ORDER_MESSAGE_FULFILLMENTS)[number];

/**
 * Statuses a message can be written for. The key is the destination status, not the pair: statuses can
 * be skipped forward, so the message that applies is the one of the status the order reaches.
 */
export const ORDER_MESSAGE_TARGET_STATUSES = ["preparing", "ready", "sent", "delivered", "cancelled"] as const;
export type OrderMessageTargetStatus = (typeof ORDER_MESSAGE_TARGET_STATUSES)[number];

export const ORDER_MESSAGE_BODY_MAX_LENGTH = 1000;
/** 5 delivery messages plus 4 takeaway ones; takeaway can never be `sent`. */
export const ORDER_MESSAGE_MAX_TEMPLATES = 9;

export const ORDER_MESSAGE_VARIABLES = [
  { token: "{nombre}", description: "nombre del cliente" },
  { token: "{numero}", description: "número del pedido" },
  { token: "{total}", description: "total del pedido" },
  { token: "{local}", description: "nombre del local" },
] as const;

export const ORDER_MESSAGE_MESSAGES = {
  bodyTooLong: `El mensaje no puede tener más de ${ORDER_MESSAGE_BODY_MAX_LENGTH} caracteres`,
  duplicate: "Hay mensajes repetidos para el mismo estado y modalidad",
  tooMany: `No se pueden guardar más de ${ORDER_MESSAGE_MAX_TEMPLATES} mensajes`,
  fulfillmentInvalid: "Modalidad inválida",
  targetStatusInvalid: "Estado destino inválido",
  takeawaySent: "Los pedidos de Take Away no se envían",
} as const;

export interface OrderMessageTemplate {
  fulfillment: OrderMessageFulfillment;
  targetStatus: OrderMessageTargetStatus;
  body: string;
}

export interface OrderMessageTemplateList {
  templates: OrderMessageTemplate[];
}

export const orderMessageTemplateSchema = z
  .object({
    fulfillment: z.enum(ORDER_MESSAGE_FULFILLMENTS, ORDER_MESSAGE_MESSAGES.fulfillmentInvalid),
    targetStatus: z.enum(ORDER_MESSAGE_TARGET_STATUSES, ORDER_MESSAGE_MESSAGES.targetStatusInvalid),
    // Empty is allowed: the service drops those rows instead of storing them.
    body: z.string().trim().max(ORDER_MESSAGE_BODY_MAX_LENGTH, ORDER_MESSAGE_MESSAGES.bodyTooLong),
  })
  .superRefine((template, ctx) => {
    if (template.fulfillment === "takeaway" && template.targetStatus === "sent") {
      ctx.addIssue({ code: "custom", message: ORDER_MESSAGE_MESSAGES.takeawaySent, path: ["targetStatus"] });
    }
  });

/** Body of `PUT /api/order-messages`: the complete list, without repeated (fulfillment, status) pairs. */
export const orderMessageTemplatesSchema = z
  .object({
    templates: z.array(orderMessageTemplateSchema).max(ORDER_MESSAGE_MAX_TEMPLATES, ORDER_MESSAGE_MESSAGES.tooMany),
  })
  .superRefine(({ templates }, ctx) => {
    const seen = new Set<string>();
    templates.forEach((template, index) => {
      const key = `${template.fulfillment}:${template.targetStatus}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", message: ORDER_MESSAGE_MESSAGES.duplicate, path: ["templates", index] });
      }
      seen.add(key);
    });
  });

export type OrderMessageTemplatesInput = z.infer<typeof orderMessageTemplatesSchema>;

/**
 * The message to send for `targetStatus`: the takeaway variant when it exists, the delivery one as the
 * fallback, and `null` when neither is written. A takeaway order is never sent.
 */
export function resolveOrderMessage(
  templates: readonly OrderMessageTemplate[],
  fulfillment: OrderMessageFulfillment,
  targetStatus: OrderMessageTargetStatus,
): string | null {
  if (fulfillment === "takeaway" && targetStatus === "sent") return null;

  const find = (wanted: OrderMessageFulfillment) =>
    templates.find(
      (template) =>
        template.fulfillment === wanted && template.targetStatus === targetStatus && template.body.trim() !== "",
    )?.body ?? null;

  return find(fulfillment) ?? (fulfillment === "takeaway" ? find("delivery") : null);
}
