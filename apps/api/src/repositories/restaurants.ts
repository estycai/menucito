import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { PlanId } from "@menucito/shared";
import {
  restaurantAppearance,
  restaurants,
  type AppearanceRow,
  type NewRestaurantRow,
  type RestaurantRow,
} from "../db/schema";
import { UniqueViolationError, translatingUniqueViolations } from "./errors";

export { UniqueViolationError };

/** Appearance fields to write; `undefined` leaves a field untouched, `null` clears a color. */
export interface AppearanceChanges {
  description?: string;
  bgColor?: string | null;
  primaryColor?: string | null;
}

/**
 * Reads and writes the restaurant together with its `restaurant_appearance` row (1:1), merged into one
 * `RestaurantRow`, so callers never see where a field is stored.
 */
export interface RestaurantsRepository {
  findByOwner(ownerId: string): Promise<RestaurantRow | null>;
  findBySlug(slug: string): Promise<RestaurantRow | null>;
  /**
   * Inserts a restaurant and its appearance row (defaults) in one D1 batch, so neither exists without
   * the other. Throws `UniqueViolationError` on duplicated `slug` or `owner_id`.
   */
  insert(row: NewRestaurantRow): Promise<RestaurantRow>;
  /** Sets (or clears, with `null`) the logo of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updateLogoUrl(id: string, logoUrl: string | null, updatedAt: Date): Promise<RestaurantRow | null>;
  /** Sets (or clears, with `null`) the cover of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updateCoverUrl(id: string, coverUrl: string | null, updatedAt: Date): Promise<RestaurantRow | null>;
  /** Writes the given appearance fields of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updateAppearance(id: string, changes: AppearanceChanges, updatedAt: Date): Promise<RestaurantRow | null>;
  /** Sets the plan of the restaurant `id`. Returns the updated row, or `null` if missing. */
  updatePlan(id: string, plan: PlanId, updatedAt: Date): Promise<RestaurantRow | null>;
}

export function createRestaurantsRepository(d1: D1Database): RestaurantsRepository {
  const db = drizzle(d1);

  // Every restaurant has its appearance row (created with it, backfilled by migration 0005), so an
  // inner join never hides one. Appearance edits are not tracked in `restaurants.updated_at`, so the
  // merged `updatedAt` is the latest of both.
  const selectMerged = () =>
    db
      .select({ restaurant: restaurants, appearance: restaurantAppearance })
      .from(restaurants)
      .innerJoin(restaurantAppearance, eq(restaurantAppearance.restaurantId, restaurants.id));

  function merge(restaurant: typeof restaurants.$inferSelect, appearance: AppearanceRow): RestaurantRow {
    return {
      ...restaurant,
      logoUrl: appearance.logoUrl,
      coverUrl: appearance.coverUrl,
      description: appearance.description,
      bgColor: appearance.bgColor,
      primaryColor: appearance.primaryColor,
      updatedAt: appearance.updatedAt > restaurant.updatedAt ? appearance.updatedAt : restaurant.updatedAt,
    };
  }

  async function findById(id: string): Promise<RestaurantRow | null> {
    const found = await selectMerged().where(eq(restaurants.id, id)).get();
    return found ? merge(found.restaurant, found.appearance) : null;
  }

  /** Applies `changes` to the appearance row of `id`; `null` when the restaurant has none. */
  async function writeAppearance(
    id: string,
    changes: Partial<Omit<AppearanceRow, "restaurantId" | "updatedAt">>,
    updatedAt: Date,
  ): Promise<RestaurantRow | null> {
    const written = await db
      .update(restaurantAppearance)
      .set({ ...changes, updatedAt })
      .where(eq(restaurantAppearance.restaurantId, id))
      .returning({ restaurantId: restaurantAppearance.restaurantId })
      .get();
    return written ? findById(id) : null;
  }

  return {
    async findByOwner(ownerId) {
      const found = await selectMerged().where(eq(restaurants.ownerId, ownerId)).get();
      return found ? merge(found.restaurant, found.appearance) : null;
    },

    async findBySlug(slug) {
      const found = await selectMerged().where(eq(restaurants.slug, slug)).get();
      return found ? merge(found.restaurant, found.appearance) : null;
    },

    async insert(row) {
      await translatingUniqueViolations(() =>
        db.batch([
          db.insert(restaurants).values(row),
          db.insert(restaurantAppearance).values({ restaurantId: row.id, updatedAt: row.updatedAt }),
        ]),
      );
      const inserted = await findById(row.id);
      if (!inserted) throw new Error("Restaurant disappeared right after insert");
      return inserted;
    },

    updateLogoUrl(id, logoUrl, updatedAt) {
      return writeAppearance(id, { logoUrl }, updatedAt);
    },

    updateCoverUrl(id, coverUrl, updatedAt) {
      return writeAppearance(id, { coverUrl }, updatedAt);
    },

    updateAppearance(id, changes, updatedAt) {
      return writeAppearance(id, changes, updatedAt);
    },

    async updatePlan(id, plan, updatedAt) {
      const written = await db
        .update(restaurants)
        .set({ plan, updatedAt })
        .where(eq(restaurants.id, id))
        .returning({ id: restaurants.id })
        .get();
      return written ? findById(id) : null;
    },
  };
}
