import type { HoursList, ReplaceHoursInput } from "@menucito/shared";
import { createHoursRepository, type HoursRepository, type StoredHoursSlot } from "../repositories/hours";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { RestaurantNotFoundError } from "./errors";

export interface HoursService {
  getHours(ownerId: string): Promise<HoursList>;
  /** Makes `input.slots` the whole week (validated by the route's schema); a day's order is kept. */
  replaceHours(ownerId: string, input: ReplaceHoursInput): Promise<HoursList>;
}

export function createHoursService(
  restaurantsRepo: RestaurantsRepository,
  hoursRepo: HoursRepository,
  generateId: () => string = () => crypto.randomUUID(),
): HoursService {
  async function restaurantIdOf(ownerId: string): Promise<string> {
    const restaurant = await restaurantsRepo.findByOwner(ownerId);
    if (!restaurant) throw new RestaurantNotFoundError();
    return restaurant.id;
  }

  return {
    async getHours(ownerId) {
      return { slots: await hoursRepo.listSlots(await restaurantIdOf(ownerId)) };
    },

    async replaceHours(ownerId, input) {
      const restaurantId = await restaurantIdOf(ownerId);
      // `sort` is the slot's position among the slots of its own weekday, in array order.
      const perDay = new Map<number, number>();
      const slots = input.slots.map((slot): StoredHoursSlot => {
        const sort = perDay.get(slot.weekday) ?? 0;
        perDay.set(slot.weekday, sort + 1);
        return { ...slot, id: generateId(), sort };
      });
      return { slots: await hoursRepo.replaceSlots(restaurantId, slots) };
    },
  };
}

export function hoursServiceFor(db: D1Database): HoursService {
  return createHoursService(createRestaurantsRepository(db), createHoursRepository(db));
}
