import { and, asc, count, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { products, type NewProductRow, type ProductRow } from "../db/schema";
import { translatingForeignKeyViolations } from "./errors";

/** Fields of a product that can be changed after creation. */
export type ProductChanges = Partial<
  Pick<ProductRow, "categoryId" | "name" | "description" | "priceCents" | "available" | "position">
>;

/**
 * Products of a restaurant. Every method takes the `restaurantId` (resolved from the session by
 * the service) and filters by it: a product is never read or written by id alone.
 */
export interface ProductsRepository {
  /** All products of the restaurant, ordered by `position`, then creation (grouped by the service). */
  list(restaurantId: string): Promise<ProductRow[]>;
  listByCategory(restaurantId: string, categoryId: string): Promise<ProductRow[]>;
  count(restaurantId: string): Promise<number>;
  countByCategory(restaurantId: string, categoryId: string): Promise<number>;
  find(restaurantId: string, id: string): Promise<ProductRow | null>;
  /** Highest `position` in the category, or `null` when it has no products. */
  maxPosition(restaurantId: string, categoryId: string): Promise<number | null>;
  /** Throws `ForeignKeyViolationError` when the category no longer exists. */
  insert(row: NewProductRow): Promise<ProductRow>;
  /** Returns the updated row, or `null` when missing. Throws `ForeignKeyViolationError` for a missing category. */
  update(restaurantId: string, id: string, changes: ProductChanges, updatedAt: Date): Promise<ProductRow | null>;
  /** Sets (or clears, with `null`) the photo. Returns the updated row, or `null` when missing. */
  updateImageUrl(restaurantId: string, id: string, imageUrl: string | null, updatedAt: Date): Promise<ProductRow | null>;
  /** Returns the deleted row (to clean up its photo), or `null` when missing. */
  delete(restaurantId: string, id: string): Promise<ProductRow | null>;
  /** Sets `position = index` for every id of the category, atomically (one D1 batch). */
  reorder(restaurantId: string, categoryId: string, ids: readonly string[], updatedAt: Date): Promise<void>;
}

export function createProductsRepository(d1: D1Database): ProductsRepository {
  const db = drizzle(d1);
  const scoped = (restaurantId: string, id: string) => and(eq(products.restaurantId, restaurantId), eq(products.id, id));
  const inCategory = (restaurantId: string, categoryId: string) =>
    and(eq(products.restaurantId, restaurantId), eq(products.categoryId, categoryId));
  const ordered = [asc(products.position), asc(products.createdAt)] as const;

  return {
    async list(restaurantId) {
      return db
        .select()
        .from(products)
        .where(eq(products.restaurantId, restaurantId))
        .orderBy(...ordered)
        .all();
    },

    async listByCategory(restaurantId, categoryId) {
      return db
        .select()
        .from(products)
        .where(inCategory(restaurantId, categoryId))
        .orderBy(...ordered)
        .all();
    },

    async count(restaurantId) {
      const row = await db.select({ value: count() }).from(products).where(eq(products.restaurantId, restaurantId)).get();
      return row?.value ?? 0;
    },

    async countByCategory(restaurantId, categoryId) {
      const row = await db.select({ value: count() }).from(products).where(inCategory(restaurantId, categoryId)).get();
      return row?.value ?? 0;
    },

    async find(restaurantId, id) {
      const row = await db.select().from(products).where(scoped(restaurantId, id)).get();
      return row ?? null;
    },

    async maxPosition(restaurantId, categoryId) {
      const row = await db
        .select({ value: max(products.position) })
        .from(products)
        .where(inCategory(restaurantId, categoryId))
        .get();
      return row?.value ?? null;
    },

    async insert(row) {
      return translatingForeignKeyViolations(() => db.insert(products).values(row).returning().get());
    },

    async update(restaurantId, id, changes, updatedAt) {
      const row = await translatingForeignKeyViolations(() =>
        db
          .update(products)
          .set({ ...changes, updatedAt })
          .where(scoped(restaurantId, id))
          .returning()
          .get(),
      );
      return row ?? null;
    },

    async updateImageUrl(restaurantId, id, imageUrl, updatedAt) {
      const row = await db
        .update(products)
        .set({ imageUrl, updatedAt })
        .where(scoped(restaurantId, id))
        .returning()
        .get();
      return row ?? null;
    },

    async delete(restaurantId, id) {
      const row = await db.delete(products).where(scoped(restaurantId, id)).returning().get();
      return row ?? null;
    },

    async reorder(restaurantId, categoryId, ids, updatedAt) {
      const [first, ...rest] = ids.map((id, position) =>
        db
          .update(products)
          .set({ position, updatedAt })
          .where(and(scoped(restaurantId, id), eq(products.categoryId, categoryId))),
      );
      if (!first) return;
      await db.batch([first, ...rest]);
    },
  };
}
