import {
  DEFAULT_COLORS,
  DEFAULT_SETTINGS,
  checkSlug,
  hasCoordinates,
  planLimitsFor,
  type PublicMenu,
  type PublicMenuCategory,
  type PublicMenuPaymentMethod,
  type PublicMenuProduct,
} from "@menucito/shared";
import type { IngredientRow, ProductRow } from "../db/schema";
import { createCategoriesRepository, type CategoriesRepository } from "../repositories/categories";
import { createDeliveryRepository, type DeliveryRepository } from "../repositories/delivery";
import { createHoursRepository, type HoursRepository } from "../repositories/hours";
import { createIngredientsRepository, type IngredientsRepository } from "../repositories/ingredients";
import { createProductsRepository, type ProductsRepository } from "../repositories/products";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createSettingsRepository, type SettingsRepository } from "../repositories/settings";
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
  ingredients: IngredientsRepository;
  settings: SettingsRepository;
  delivery: DeliveryRepository;
  hours: HoursRepository;
}

function toPublicProduct(row: ProductRow, ingredients: readonly IngredientRow[]): PublicMenuProduct {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    imageUrl: row.imageUrl,
    available: row.available,
    ingredients: ingredients.map((ingredient) => ({
      name: ingredient.name,
      includedQty: ingredient.includedQty,
      minQty: ingredient.minQty,
      maxQty: ingredient.maxQty,
      extraPriceCents: ingredient.extraPriceCents,
    })),
  };
}

/**
 * The diner-facing menu of a restaurant, looked up by its public slug. Read only and independent of
 * the restaurant status; only the plan decides whether ingredients are published. Only whitelisted
 * fields are mapped, so a new column of the database never leaks into the public shape by accident.
 */
export function createPublicMenuService({
  restaurants,
  categories,
  products,
  ingredients,
  settings,
  delivery,
  hours,
}: PublicMenuDependencies) {
  return {
    /** Throws `MenuNotFoundError` for a malformed, reserved or unknown slug. */
    async getBySlug(slug: string): Promise<PublicMenu> {
      // Malformed and reserved slugs cannot exist, so skip the database.
      if (checkSlug(slug)) throw new MenuNotFoundError();
      const restaurant = await restaurants.findBySlug(slug);
      if (!restaurant) throw new MenuNotFoundError();

      // Ingredients saved before a downgrade stay in the database but are never published on a plan
      // without customizable ingredients, so skip the query altogether.
      const withIngredients = planLimitsFor(restaurant.plan).customIngredients;
      const [categoryRows, productRows, ingredientRows, storeSettingsRaw, location, hourSlots] = await Promise.all([
        categories.list(restaurant.id),
        products.list(restaurant.id),
        withIngredients ? ingredients.listByRestaurant(restaurant.id) : Promise.resolve([]),
        settings.findSettings(restaurant.id),
        delivery.findLocation(restaurant.id),
        hours.listSlots(restaurant.id),
      ]);

      if (!storeSettingsRaw) {
        console.warn(`[public-menu] restaurant ${restaurant.id} missing settings row, using safe defaults`);
      }
      const storeSettings = storeSettingsRaw ?? DEFAULT_SETTINGS;

      const ingredientsByProduct = new Map<string, IngredientRow[]>();
      for (const row of ingredientRows) {
        const list = ingredientsByProduct.get(row.productId) ?? [];
        list.push(row);
        ingredientsByProduct.set(row.productId, list);
      }

      const byCategory = new Map<string, PublicMenuProduct[]>();
      for (const row of productRows) {
        const list = byCategory.get(row.categoryId) ?? [];
        list.push(toPublicProduct(row, ingredientsByProduct.get(row.id) ?? []));
        byCategory.set(row.categoryId, list);
      }

      // The featured category is published apart (and only when it has products), never in `categories`.
      let featured: PublicMenuCategory | null = null;
      const menuCategories: PublicMenuCategory[] = [];
      for (const category of categoryRows) {
        const list = byCategory.get(category.id);
        if (category.isFeatured) {
          if (list?.length) featured = { name: category.name, products: list };
        } else if (list?.length) {
          menuCategories.push({ name: category.name, products: list });
        }
      }

      // Saved colors stay dormant (not deleted) on a plan without custom colors.
      const customColors = planLimitsFor(restaurant.plan).customColors;

      const enabledPaymentMethods: PublicMenuPaymentMethod[] = storeSettings.paymentMethods
        .filter((pm) => pm.enabled)
        .map((pm) => ({
          method: pm.method,
          alias: pm.method === "transfer" ? pm.alias : null,
          holderName: pm.method === "transfer" ? pm.holderName : null,
        }));

      // Zones need the store's coordinates; a store without them keeps the flat price. The zones
      // themselves are never published: the diner only gets quotes.
      const zonesLocation =
        restaurant.delivery && location?.deliveryMode === "zones" && hasCoordinates(location)
          ? { lat: location.lat, lng: location.lng }
          : null;

      return {
        restaurant: {
          name: restaurant.name,
          slug: restaurant.slug,
          logoUrl: restaurant.logoUrl,
          delivery: restaurant.delivery,
          takeaway: restaurant.takeaway,
          coverUrl: restaurant.coverUrl,
          description: restaurant.description,
          colors: {
            background: (customColors && restaurant.bgColor) || DEFAULT_COLORS.background,
            primary: (customColors && restaurant.primaryColor) || DEFAULT_COLORS.primary,
          },
          acceptingOrders: storeSettings.acceptingOrders,
          hours: hourSlots,
          acceptOrdersOutsideHours: storeSettings.acceptOrdersOutsideHours,
          minOrderCents: storeSettings.minOrderCents,
          shippingCents: storeSettings.shippingCents,
          deliveryMode: zonesLocation ? "zones" : "flat",
          location: zonesLocation,
          paymentMethods: enabledPaymentMethods,
        },
        featured,
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
    ingredients: createIngredientsRepository(db),
    settings: createSettingsRepository(db),
    delivery: createDeliveryRepository(db),
    hours: createHoursRepository(db),
  });
}
