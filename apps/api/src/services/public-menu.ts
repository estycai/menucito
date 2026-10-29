import { checkSlug, type PublicMenu, type PublicMenuCategory, type PublicMenuProduct } from "@menucito/shared";
import type { ProductRow } from "../db/schema";
import { createCategoriesRepository, type CategoriesRepository } from "../repositories/categories";
import { createProductsRepository, type ProductsRepository } from "../repositories/products";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { DomainError } from "./errors";

/** No restaurant is published under that slug. Same code as the owner-side 404, public wording. */
export class MenuNotFoundError extends DomainError {
  readonly code = "RESTAURANT_NOT_FOUND";
  constructor() {
    super("Menu not found");
  }
}

export interface PublicMenuDependencies {
  restaurants: RestaurantsRepository;
  categories: CategoriesRepository;
  products: ProductsRepository;
}

function toPublicProduct(row: ProductRow): PublicMenuProduct {
  return {
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    imageUrl: row.imageUrl,
    available: row.available,
  };
}

/**
 * The diner-facing menu of a restaurant, looked up by its public slug. Read only and independent of
 * the plan and the restaurant status. Only whitelisted fields are mapped, so a new column of the
 * database never leaks into the public shape by accident.
 */
export function createPublicMenuService({ restaurants, categories, products }: PublicMenuDependencies) {
  return {
    /** Throws `MenuNotFoundError` for a malformed, reserved or unknown slug. */
    async getBySlug(slug: string): Promise<PublicMenu> {
      // Malformed and reserved slugs cannot exist, so skip the database.
      if (checkSlug(slug)) throw new MenuNotFoundError();
      const restaurant = await restaurants.findBySlug(slug);
      if (!restaurant) throw new MenuNotFoundError();

      const [categoryRows, productRows] = await Promise.all([
        categories.list(restaurant.id),
        products.list(restaurant.id),
      ]);
      const byCategory = new Map<string, PublicMenuProduct[]>();
      for (const row of productRows) {
        const list = byCategory.get(row.categoryId) ?? [];
        list.push(toPublicProduct(row));
        byCategory.set(row.categoryId, list);
      }

      const menuCategories: PublicMenuCategory[] = [];
      for (const category of categoryRows) {
        const list = byCategory.get(category.id);
        if (list?.length) menuCategories.push({ name: category.name, products: list });
      }

      return {
        restaurant: { name: restaurant.name, slug: restaurant.slug, logoUrl: restaurant.logoUrl },
        categories: menuCategories,
      };
    },
  };
}

export type PublicMenuService = ReturnType<typeof createPublicMenuService>;

/** Wires the service with its D1-backed repositories. */
export function publicMenuServiceFor(db: D1Database): PublicMenuService {
  return createPublicMenuService({
    restaurants: createRestaurantsRepository(db),
    categories: createCategoriesRepository(db),
    products: createProductsRepository(db),
  });
}
