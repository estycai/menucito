import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ingredients, products, type IngredientRow, type NewIngredientRow } from "../db/schema";
import { translatingForeignKeyViolations } from "./errors";

/**
 * Customizable ingredients of products. Ingredients have no tenant column of their own: the service
 * resolves the product through its restaurant first (`ProductsRepository.find`) and only then reads
 * or replaces by `productId`. The bulk read joins `products` to stay scoped by `restaurantId`.
 */
export interface IngredientsRepository {
  /** Ingredients of every product of the restaurant in one query, ordered by product, then `position`. */
  listByRestaurant(restaurantId: string): Promise<IngredientRow[]>;
  /** Ingredients of one product, ordered by `position`. */
  listByProduct(productId: string): Promise<IngredientRow[]>;
  /**
   * Replaces the whole list of the product in one D1 batch, so a failure leaves the old list.
   * Throws `ForeignKeyViolationError` when the product no longer exists.
   */
  replace(productId: string, rows: readonly NewIngredientRow[]): Promise<void>;
}

export function createIngredientsRepository(d1: D1Database): IngredientsRepository {
  const db = drizzle(d1);

  return {
    async listByRestaurant(restaurantId) {
      const rows = await db
        .select({ ingredient: ingredients })
        .from(ingredients)
        .innerJoin(products, eq(ingredients.productId, products.id))
        .where(eq(products.restaurantId, restaurantId))
        .orderBy(asc(ingredients.productId), asc(ingredients.position))
        .all();
      return rows.map((row) => row.ingredient);
    },

    async listByProduct(productId) {
      return db
        .select()
        .from(ingredients)
        .where(eq(ingredients.productId, productId))
        .orderBy(asc(ingredients.position))
        .all();
    },

    async replace(productId, rows) {
      // One statement per row: D1 allows at most 100 bound parameters per statement.
      await translatingForeignKeyViolations(() =>
        db.batch([
          db.delete(ingredients).where(eq(ingredients.productId, productId)),
          ...rows.map((row) => db.insert(ingredients).values(row)),
        ]),
      );
    },
  };
}
