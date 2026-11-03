import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { customers, type CustomerRow } from "../db/schema";

export interface CustomersRepository {
  findByPhone(restaurantId: string, phone: string): Promise<CustomerRow | null>;
}

export function createCustomersRepository(d1: D1Database): CustomersRepository {
  const db = drizzle(d1);

  return {
    async findByPhone(restaurantId, phone) {
      const row = await db
        .select()
        .from(customers)
        .where(and(eq(customers.restaurantId, restaurantId), eq(customers.phone, phone)))
        .get();
      return row ?? null;
    },
  };
}
