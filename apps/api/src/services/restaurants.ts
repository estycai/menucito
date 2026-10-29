import {
  checkSlug,
  normalizeArWhatsapp,
  type CreateRestaurantInput,
  type PlanId,
  type Restaurant,
  type SlugAvailability,
} from "@menucito/shared";
import type { RestaurantRow } from "../db/schema";
import {
  UniqueViolationError,
  createRestaurantsRepository,
  type RestaurantsRepository,
} from "../repositories/restaurants";
import { DomainError, RestaurantNotFoundError, ValidationError } from "./errors";

export class SlugTakenError extends DomainError {
  readonly code = "SLUG_TAKEN";
  constructor() {
    super("That slug is already in use");
  }
}

export class AlreadyHasRestaurantError extends DomainError {
  readonly code = "ALREADY_HAS_RESTAURANT";
  constructor() {
    super("You already have a restaurant");
  }
}

export class PlanSwitchDisabledError extends DomainError {
  readonly code = "PLAN_SWITCH_DISABLED";
  constructor() {
    super("Switching plans is not enabled in this environment");
  }
}

export class InvalidRestaurantError extends ValidationError {}

function toRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    whatsapp: row.whatsapp,
    delivery: row.delivery,
    takeaway: row.takeaway,
    logoUrl: row.logoUrl,
    plan: row.plan,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createRestaurantsService(repository: RestaurantsRepository) {
  return {
    /** The restaurant owned by `ownerId`. Throws `RestaurantNotFoundError` when there is none. */
    async getMine(ownerId: string): Promise<Restaurant> {
      const row = await repository.findByOwner(ownerId);
      if (!row) throw new RestaurantNotFoundError();
      return toRestaurant(row);
    },

    async checkSlugAvailability(slug: string): Promise<SlugAvailability> {
      const problem = checkSlug(slug);
      if (problem) return { available: false, reason: problem };
      if (await repository.findBySlug(slug)) return { available: false, reason: "taken" };
      return { available: true };
    },

    /**
     * Sets the plan of the owner's restaurant, for free. Only a testing aid until payments exist, so it
     * is refused with `PlanSwitchDisabledError` unless `options.enabled`. Choosing the current plan is a
     * no-op. Products are never touched: a downgrade only affects the creation limit.
     */
    async changePlan(ownerId: string, plan: PlanId, options: { enabled: boolean }): Promise<Restaurant> {
      if (!options.enabled) throw new PlanSwitchDisabledError();
      const current = await repository.findByOwner(ownerId);
      if (!current) throw new RestaurantNotFoundError();
      if (current.plan === plan) return toRestaurant(current);
      const updated = await repository.updatePlan(current.id, plan, new Date());
      if (!updated) throw new RestaurantNotFoundError();
      return toRestaurant(updated);
    },

    /**
     * Creates the owner's restaurant. `input` must already be validated with `createRestaurantSchema`.
     * Slug and owner uniqueness are enforced by the database, so concurrent requests still get a
     * domain error instead of a duplicate.
     */
    async create(ownerId: string, input: CreateRestaurantInput): Promise<Restaurant> {
      const whatsapp = normalizeArWhatsapp(input.whatsapp);
      if (!whatsapp) throw new InvalidRestaurantError("Invalid WhatsApp number");

      if (await repository.findByOwner(ownerId)) throw new AlreadyHasRestaurantError();

      const now = new Date();
      try {
        const row = await repository.insert({
          id: crypto.randomUUID(),
          ownerId,
          slug: input.slug,
          name: input.name,
          whatsapp,
          delivery: input.delivery,
          takeaway: input.takeaway,
          createdAt: now,
          updatedAt: now,
        });
        return toRestaurant(row);
      } catch (error) {
        if (error instanceof UniqueViolationError) {
          throw error.column === "slug" ? new SlugTakenError() : new AlreadyHasRestaurantError();
        }
        throw error;
      }
    },
  };
}

export type RestaurantsService = ReturnType<typeof createRestaurantsService>;

/** Wires the service with its D1-backed repository. */
export function restaurantsServiceFor(db: D1Database): RestaurantsService {
  return createRestaurantsService(createRestaurantsRepository(db));
}
