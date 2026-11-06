import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { OrderMessageTemplate } from "@menucito/shared";
import { orderMessageTemplates } from "../db/schema";

export interface OrderMessagesRepository {
  list(restaurantId: string): Promise<OrderMessageTemplate[]>;
  /** Replaces every message of the restaurant with `templates`, in one batch. */
  replaceAll(restaurantId: string, templates: readonly OrderMessageTemplate[], updatedAt: Date): Promise<OrderMessageTemplate[]>;
}

export function createOrderMessagesRepository(d1: D1Database): OrderMessagesRepository {
  const db = drizzle(d1);

  async function list(restaurantId: string): Promise<OrderMessageTemplate[]> {
    const rows = await db
      .select()
      .from(orderMessageTemplates)
      .where(eq(orderMessageTemplates.restaurantId, restaurantId))
      .orderBy(asc(orderMessageTemplates.fulfillment), asc(orderMessageTemplates.targetStatus))
      .all();
    return rows.map((row) => ({
      fulfillment: row.fulfillment as OrderMessageTemplate["fulfillment"],
      targetStatus: row.targetStatus as OrderMessageTemplate["targetStatus"],
      body: row.body,
    }));
  }

  return {
    list,

    async replaceAll(restaurantId, templates, updatedAt) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [
        db.delete(orderMessageTemplates).where(eq(orderMessageTemplates.restaurantId, restaurantId)),
        ...templates.map((template) =>
          db.insert(orderMessageTemplates).values({ restaurantId, ...template, updatedAt }),
        ),
      ];
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
      return list(restaurantId);
    },
  };
}
