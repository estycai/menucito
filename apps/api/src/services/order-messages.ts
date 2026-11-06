import type { OrderMessageTemplate, OrderMessageTemplatesInput } from "@menucito/shared";
import { createOrderMessagesRepository, type OrderMessagesRepository } from "../repositories/order-messages";

export function createOrderMessagesService(
  repo: OrderMessagesRepository,
  now: () => Date = () => new Date(),
) {
  return {
    list(restaurantId: string): Promise<OrderMessageTemplate[]> {
      return repo.list(restaurantId);
    },

    /**
     * Replaces the whole set. Blank bodies are dropped instead of stored (an empty field means "no
     * message", and a takeaway message has the delivery one as fallback).
     */
    async replace(restaurantId: string, input: OrderMessageTemplatesInput): Promise<{ templates: OrderMessageTemplate[] }> {
      const templates = input.templates
        .map((template) => ({ ...template, body: template.body.trim() }))
        .filter((template) => template.body.length > 0);
      return { templates: await repo.replaceAll(restaurantId, templates, now()) };
    },
  };
}

export type OrderMessagesService = ReturnType<typeof createOrderMessagesService>;

export function orderMessagesServiceFor(db: D1Database): OrderMessagesService {
  return createOrderMessagesService(createOrderMessagesRepository(db));
}
