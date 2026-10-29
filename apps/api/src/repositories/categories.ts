import { and, asc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { categories, type CategoryRow, type NewCategoryRow } from "../db/schema";
import { translatingForeignKeyViolations, translatingUniqueViolations } from "./errors";

/** Name of the unique index on `(restaurant_id, lower(name))`, reported by SQLite on duplicates. */
export const CATEGORY_NAME_UNIQUE_INDEX = "categories_restaurant_name_unique";

/**
 * Categories of a restaurant. Every method takes the `restaurantId` (resolved from the session by
 * the service) and filters by it: a category is never read or written by id alone.
 */
export interface CategoriesRepository {
  /** Categories ordered by `position`, then creation. */
  list(restaurantId: string): Promise<CategoryRow[]>;
  find(restaurantId: string, id: string): Promise<CategoryRow | null>;
  /** Highest `position` in use, or `null` when the restaurant has no categories. */
  maxPosition(restaurantId: string): Promise<number | null>;
  /** Throws `UniqueViolationError` (index `CATEGORY_NAME_UNIQUE_INDEX`) on a duplicated name. */
  insert(row: NewCategoryRow): Promise<CategoryRow>;
  /** Returns the updated row, or `null` when missing. Throws `UniqueViolationError` on a duplicated name. */
  rename(restaurantId: string, id: string, name: string, updatedAt: Date): Promise<CategoryRow | null>;
  /** Returns whether a row was deleted. Throws `ForeignKeyViolationError` when it still has products. */
  delete(restaurantId: string, id: string): Promise<boolean>;
  /** Sets `position = index` for every id, atomically (one D1 batch). */
  reorder(restaurantId: string, ids: readonly string[], updatedAt: Date): Promise<void>;
}

export function createCategoriesRepository(d1: D1Database): CategoriesRepository {
  const db = drizzle(d1);
  const scoped = (restaurantId: string, id: string) =>
    and(eq(categories.restaurantId, restaurantId), eq(categories.id, id));

  return {
    async list(restaurantId) {
      return db
        .select()
        .from(categories)
        .where(eq(categories.restaurantId, restaurantId))
        .orderBy(asc(categories.position), asc(categories.createdAt))
        .all();
    },

    async find(restaurantId, id) {
      const row = await db.select().from(categories).where(scoped(restaurantId, id)).get();
      return row ?? null;
    },

    async maxPosition(restaurantId) {
      const row = await db
        .select({ value: max(categories.position) })
        .from(categories)
        .where(eq(categories.restaurantId, restaurantId))
        .get();
      return row?.value ?? null;
    },

    async insert(row) {
      return translatingUniqueViolations(() => db.insert(categories).values(row).returning().get());
    },

    async rename(restaurantId, id, name, updatedAt) {
      const row = await translatingUniqueViolations(() =>
        db.update(categories).set({ name, updatedAt }).where(scoped(restaurantId, id)).returning().get(),
      );
      return row ?? null;
    },

    async delete(restaurantId, id) {
      const row = await translatingForeignKeyViolations(() =>
        db.delete(categories).where(scoped(restaurantId, id)).returning({ id: categories.id }).get(),
      );
      return Boolean(row);
    },

    async reorder(restaurantId, ids, updatedAt) {
      const [first, ...rest] = ids.map((id, position) =>
        db.update(categories).set({ position, updatedAt }).where(scoped(restaurantId, id)),
      );
      if (!first) return;
      await db.batch([first, ...rest]);
    },
  };
}
