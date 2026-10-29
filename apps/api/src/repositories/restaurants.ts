import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { PlanId } from "@menucito/shared";
import { restaurants, type NewRestaurantRow, type RestaurantRow } from "../db/schema";
import { UniqueViolationError, translatingUniqueViolations } from "./errors";

export { UniqueViolationError };

export interface RestaurantsRepository {
  findByOwner(ownerId: string): Promise<RestaurantRow | null>;
  findBySlug(slug: string): Promise<RestaurantRow | null>;
  /** Inserts a restaurant. Throws `UniqueViolationError` on duplicated `slug` or `owner_id`. */
  insert(row: NewRestaurantRow): Promise<RestaurantRow>;
  /** Sets (or clears, with `null`) the logo of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updateLogoUrl(id: string, logoUrl: string | null, updatedAt: Date): Promise<RestaurantRow | null>;
  /** Sets the plan of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updatePlan(id: string, plan: PlanId, updatedAt: Date): Promise<RestaurantRow | null>;
}

export function createRestaurantsRepository(d1: D1Database): RestaurantsRepository {
  const db = drizzle(d1);

  return {
    async findByOwner(ownerId) {
      const row = await db.select().from(restaurants).where(eq(restaurants.ownerId, ownerId)).get();
      return row ?? null;
    },

    async findBySlug(slug) {
      const row = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).get();
      return row ?? null;
    },

    async insert(row) {
      return translatingUniqueViolations(() => db.insert(restaurants).values(row).returning().get());
    },

    async updateLogoUrl(id, logoUrl, updatedAt) {
      const row = await db
        .update(restaurants)
        .set({ logoUrl, updatedAt })
        .where(eq(restaurants.id, id))
        .returning()
        .get();
      return row ?? null;
    },

    async updatePlan(id, plan, updatedAt) {
      const row = await db
        .update(restaurants)
        .set({ plan, updatedAt })
        .where(eq(restaurants.id, id))
        .returning()
        .get();
      return row ?? null;
    },
  };
}
