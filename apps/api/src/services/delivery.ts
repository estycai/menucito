import type { DeliveryZone, DeliveryZoneList, ReplaceDeliveryZonesInput, StoreLocation } from "@menucito/shared";
import { createDeliveryRepository, type DeliveryRepository } from "../repositories/delivery";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { RestaurantNotFoundError } from "./errors";

/** Location of a store that never set one (and of one missing its settings row). */
const NO_LOCATION: StoreLocation = {
  deliveryMode: "flat",
  address: null,
  addressNotes: null,
  lat: null,
  lng: null,
  placeId: null,
};

export interface DeliveryService {
  getLocation(ownerId: string): Promise<StoreLocation>;
  /** Replaces the location and mode (validated by the route's schema). */
  updateLocation(ownerId: string, location: StoreLocation): Promise<StoreLocation>;
  listZones(ownerId: string): Promise<DeliveryZoneList>;
  /** Makes `input.zones` the full list, in that order. */
  replaceZones(ownerId: string, input: ReplaceDeliveryZonesInput): Promise<DeliveryZoneList>;
}

export function createDeliveryService(
  restaurantsRepo: RestaurantsRepository,
  deliveryRepo: DeliveryRepository,
  now: () => Date = () => new Date(),
  generateId: () => string = () => crypto.randomUUID(),
): DeliveryService {
  async function restaurantIdOf(ownerId: string): Promise<string> {
    const restaurant = await restaurantsRepo.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant.id;
  }

  return {
    async getLocation(ownerId) {
      const restaurantId = await restaurantIdOf(ownerId);
      return (await deliveryRepo.findLocation(restaurantId)) ?? NO_LOCATION;
    },

    async updateLocation(ownerId, location) {
      const restaurantId = await restaurantIdOf(ownerId);
      return deliveryRepo.upsertLocation(restaurantId, location, now());
    },

    async listZones(ownerId) {
      const restaurantId = await restaurantIdOf(ownerId);
      return { zones: await deliveryRepo.listZones(restaurantId) };
    },

    async replaceZones(ownerId, input) {
      const restaurantId = await restaurantIdOf(ownerId);
      const existingIds = new Set((await deliveryRepo.listZones(restaurantId)).map((zone) => zone.id));

      // An id is kept only when it is one of this store's zones and not repeated in the list;
      // anything else (stale, foreign or duplicated) becomes a new zone.
      const usedIds = new Set<string>();
      const zones = input.zones.map((zone, index): DeliveryZone => {
        const id = zone.id && existingIds.has(zone.id) && !usedIds.has(zone.id) ? zone.id : generateId();
        usedIds.add(id);
        return { ...zone, id, sort: index };
      });

      return { zones: await deliveryRepo.replaceZones(restaurantId, zones, now()) };
    },
  };
}

export function deliveryServiceFor(db: D1Database): DeliveryService {
  return createDeliveryService(createRestaurantsRepository(db), createDeliveryRepository(db));
}
