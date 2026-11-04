import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { HoursFulfillment, HoursSlot, Weekday } from "@menucito/shared";
import { restaurantHours } from "../db/schema";

/** A slot ready to store: its id and its position within the weekday. */
export interface StoredHoursSlot extends HoursSlot {
  id: string;
  sort: number;
}

/** The `restaurant_hours` rows of a store, mapped to the shared `HoursSlot` shape. */
export interface HoursRepository {
  /** Slots of the restaurant by weekday, then by their position within the day. */
  listSlots(restaurantId: string): Promise<HoursSlot[]>;
  /** Makes `slots` the whole week of the restaurant in one batch (delete all, insert all). */
  replaceSlots(restaurantId: string, slots: readonly StoredHoursSlot[]): Promise<HoursSlot[]>;
}

export function createHoursRepository(d1: D1Database): HoursRepository {
  const db = drizzle(d1);

  async function listSlots(restaurantId: string): Promise<HoursSlot[]> {
    const rows = await db
      .select()
      .from(restaurantHours)
      .where(eq(restaurantHours.restaurantId, restaurantId))
      .orderBy(asc(restaurantHours.weekday), asc(restaurantHours.sort))
      .all();
    return rows.map((row) => ({
      weekday: row.weekday as Weekday,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      fulfillment: row.fulfillment as HoursFulfillment,
    }));
  }

  return {
    listSlots,

    async replaceSlots(restaurantId, slots) {
      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const statements: BatchStatement[] = [db.delete(restaurantHours).where(eq(restaurantHours.restaurantId, restaurantId))];
      // One insert per slot: a full week in a single statement would pass D1's 100 bound parameters.
      for (const slot of slots) statements.push(db.insert(restaurantHours).values({ ...slot, restaurantId }));
      await db.batch(statements as [BatchStatement, ...BatchStatement[]]);
      return listSlots(restaurantId);
    },
  };
}
