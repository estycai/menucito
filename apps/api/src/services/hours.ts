import type { HoursList, ReplaceHoursInput } from "@menucito/shared";
import { createHoursRepository, type HoursRepository, type StoredHoursSlot } from "../repositories/hours";

export interface HoursService {
  getHours(restaurantId: string): Promise<HoursList>;
  /** Makes `input.slots` the whole week (validated by the route's schema); a day's order is kept. */
  replaceHours(restaurantId: string, input: ReplaceHoursInput): Promise<HoursList>;
}

export function createHoursService(
  hoursRepo: HoursRepository,
  generateId: () => string = () => crypto.randomUUID(),
): HoursService {
  return {
    async getHours(restaurantId) {
      return { slots: await hoursRepo.listSlots(restaurantId) };
    },

    async replaceHours(restaurantId, input) {
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
  return createHoursService(createHoursRepository(db));
}
