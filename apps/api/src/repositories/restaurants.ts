import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { restaurants, type NewRestaurantRow, type RestaurantRow } from "../db/schema";

/** Raised when an insert hits a UNIQUE constraint; `column` names the violated column. */
export class UniqueViolationError extends Error {
  constructor(readonly column: string) {
    super(`Unique constraint failed: restaurants.${column}`);
    this.name = "UniqueViolationError";
  }
}

/** Walks the error cause chain (Drizzle wraps the D1 error) looking for a SQLite UNIQUE failure. */
function uniqueViolationColumn(error: unknown): string | null {
  for (let current = error; current instanceof Error; current = current.cause) {
    const match = /UNIQUE constraint failed: restaurants\.(\w+)/.exec(current.message);
    if (match?.[1]) return match[1];
  }
  return null;
}

export interface RestaurantsRepository {
  findByOwner(ownerId: string): Promise<RestaurantRow | null>;
  findBySlug(slug: string): Promise<RestaurantRow | null>;
  /** Inserts a restaurant. Throws `UniqueViolationError` on duplicated `slug` or `owner_id`. */
  insert(row: NewRestaurantRow): Promise<RestaurantRow>;
  /** Sets (or clears, with `null`) the logo of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updateLogoUrl(id: string, logoUrl: string | null, updatedAt: Date): Promise<RestaurantRow | null>;
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
      try {
        return await db.insert(restaurants).values(row).returning().get();
      } catch (error) {
        const column = uniqueViolationColumn(error);
        if (column) throw new UniqueViolationError(column);
        throw error;
      }
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
  };
}
