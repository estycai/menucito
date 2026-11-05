import {
  checkSlug,
  hasCoordinates,
  quoteDelivery,
  toPublicQuote,
  type DeliveryQuoteRequest,
  type DeliveryZone,
  type DeliveryZoneList,
  type LatLng,
  type PublicDeliveryQuote,
  type ReplaceDeliveryZonesInput,
  type StoreLocation,
} from "@menucito/shared";
import type { RestaurantRow } from "../db/schema";
import { createDeliveryRepository, type DeliveryRepository } from "../repositories/delivery";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { DeliveryZonesDisabledError } from "./errors";
import { MenuNotFoundError } from "./public-menu";

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
  getLocation(restaurantId: string): Promise<StoreLocation>;
  /** Replaces the location and mode (validated by the route's schema). */
  updateLocation(restaurantId: string, location: StoreLocation): Promise<StoreLocation>;
  listZones(restaurantId: string): Promise<DeliveryZoneList>;
  /** Makes `input.zones` the full list, in that order. */
  replaceZones(restaurantId: string, input: ReplaceDeliveryZonesInput): Promise<DeliveryZoneList>;
}

export function createDeliveryService(
  deliveryRepo: DeliveryRepository,
  now: () => Date = () => new Date(),
  generateId: () => string = () => crypto.randomUUID(),
): DeliveryService {
  return {
    async getLocation(restaurantId) {
      return (await deliveryRepo.findLocation(restaurantId)) ?? NO_LOCATION;
    },

    async updateLocation(restaurantId, location) {
      return deliveryRepo.upsertLocation(restaurantId, location, now());
    },

    async listZones(restaurantId) {
      return { zones: await deliveryRepo.listZones(restaurantId) };
    },

    async replaceZones(restaurantId, input) {
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
  return createDeliveryService(createDeliveryRepository(db));
}

/** Whether a store prices delivery by zones: it delivers, chose `zones` and has its coordinates. */
export function deliversByZones(
  restaurant: Pick<RestaurantRow, "delivery">,
  location: StoreLocation | null,
): location is StoreLocation & LatLng & { address: string } {
  return restaurant.delivery && location?.deliveryMode === "zones" && hasCoordinates(location);
}

/** A published store that delivers by zones, with the origin its radius and ring zones measure from. */
export interface ZonesStore {
  restaurantId: string;
  origin: LatLng;
}

/**
 * The store behind a public menu slug, for the diner-side address search and quote. Throws
 * `MenuNotFoundError` for an unknown slug and `DeliveryZonesDisabledError` when the store does not
 * deliver by zones (those endpoints would only spend Google quota for nothing).
 */
export async function requireZonesStore(
  restaurantsRepo: RestaurantsRepository,
  deliveryRepo: DeliveryRepository,
  slug: string,
): Promise<ZonesStore> {
  if (checkSlug(slug)) throw new MenuNotFoundError();
  const restaurant = await restaurantsRepo.findBySlug(slug);
  if (!restaurant) throw new MenuNotFoundError();
  const location = await deliveryRepo.findLocation(restaurant.id);
  if (!deliversByZones(restaurant, location)) throw new DeliveryZonesDisabledError();
  return { restaurantId: restaurant.id, origin: { lat: location.lat, lng: location.lng } };
}

/** Diner side of delivery zones: what an address pays, without revealing the zones. */
export interface PublicDeliveryService {
  quote(slug: string, request: DeliveryQuoteRequest): Promise<PublicDeliveryQuote>;
}

export function createPublicDeliveryService(
  restaurantsRepo: RestaurantsRepository,
  deliveryRepo: DeliveryRepository,
): PublicDeliveryService {
  return {
    async quote(slug, { lat, lng, subtotalCents }) {
      const store = await requireZonesStore(restaurantsRepo, deliveryRepo, slug);
      const zones = await deliveryRepo.listZones(store.restaurantId);
      return toPublicQuote(quoteDelivery({ zones, origin: store.origin, point: { lat, lng }, subtotalCents }));
    },
  };
}

export function publicDeliveryServiceFor(db: D1Database): PublicDeliveryService {
  return createPublicDeliveryService(createRestaurantsRepository(db), createDeliveryRepository(db));
}
