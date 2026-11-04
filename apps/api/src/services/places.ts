import { hasCoordinates, type PlaceResult, type PlaceSuggestion } from "@menucito/shared";
import { GoogleMapsError, googleMapsClient, type PlacesClient } from "../google-maps";
import type { Env } from "../env";
import { createDeliveryRepository, type DeliveryRepository } from "../repositories/delivery";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { MapsUnavailableError, PlaceNotFoundError, RestaurantNotFoundError } from "./errors";

/** Address search for the owner (the store's own address), near the store when it is known. */
export interface PlacesService {
  search(ownerId: string, query: string, sessionToken: string): Promise<PlaceSuggestion[]>;
  details(ownerId: string, placeId: string, sessionToken: string): Promise<PlaceResult>;
}

/** Google failures as domain errors: an unknown place is a 404, anything else a retryable 503. */
async function translatingMapsErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof GoogleMapsError)) throw error;
    if (error.reason === "not_found") throw new PlaceNotFoundError();
    if (error.reason === "not_configured") console.warn("[places] GOOGLE_MAPS_SERVER_KEY is missing");
    throw new MapsUnavailableError();
  }
}

export function createPlacesService(
  restaurantsRepo: RestaurantsRepository,
  deliveryRepo: DeliveryRepository,
  client: PlacesClient,
): PlacesService {
  async function requireRestaurantId(ownerId: string): Promise<string> {
    const restaurant = await restaurantsRepo.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant.id;
  }

  return {
    async search(ownerId, query, sessionToken) {
      const restaurantId = await requireRestaurantId(ownerId);
      const location = await deliveryRepo.findLocation(restaurantId);
      const bias = location && hasCoordinates(location) ? { lat: location.lat, lng: location.lng } : undefined;
      return translatingMapsErrors(() => client.autocomplete({ input: query, sessionToken, bias }));
    },

    async details(ownerId, placeId, sessionToken) {
      await requireRestaurantId(ownerId);
      return translatingMapsErrors(() => client.placeDetails({ placeId, sessionToken }));
    },
  };
}

export function placesServiceFor(env: Pick<Env, "DB" | "GOOGLE_MAPS_SERVER_KEY">): PlacesService {
  return createPlacesService(createRestaurantsRepository(env.DB), createDeliveryRepository(env.DB), googleMapsClient(env));
}
