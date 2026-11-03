import {
  DEFAULT_SETTINGS,
  settingsProblem,
  type PaymentMethodSetting,
  type StoreSettings,
  type UpdateSettingsInput,
} from "@menucito/shared";
import { createRestaurantsRepository, type RestaurantsRepository } from "../repositories/restaurants";
import { createSettingsRepository, type SettingsRepository } from "../repositories/settings";
import { RestaurantNotFoundError, ValidationError } from "./errors";

export interface SettingsService {
  getSettings(ownerId: string): Promise<StoreSettings>;
  updateSettings(ownerId: string, changes: UpdateSettingsInput): Promise<StoreSettings>;
}

export function createSettingsService(
  restaurantsRepo: RestaurantsRepository,
  settingsRepo: SettingsRepository,
  now: () => Date = () => new Date(),
): SettingsService {
  return {
    async getSettings(ownerId: string): Promise<StoreSettings> {
      const restaurant = await restaurantsRepo.findByOwner(ownerId);
      if (!restaurant) throw new RestaurantNotFoundError();

      const settings = await settingsRepo.findSettings(restaurant.id);
      if (!settings) {
        console.warn(`[settings] restaurant ${restaurant.id} missing settings row, using safe defaults`);
        return DEFAULT_SETTINGS;
      }

      return settings;
    },

    async updateSettings(ownerId: string, changes: UpdateSettingsInput): Promise<StoreSettings> {
      const restaurant = await restaurantsRepo.findByOwner(ownerId);
      if (!restaurant) throw new RestaurantNotFoundError();

      let current = await settingsRepo.findSettings(restaurant.id);
      if (!current) {
        console.warn(`[settings] restaurant ${restaurant.id} missing settings row on update, using safe defaults`);
        current = DEFAULT_SETTINGS;
      }

      // Merge payment methods
      const resultingMethods: PaymentMethodSetting[] = [...current.paymentMethods];
      if (changes.paymentMethods) {
        for (const updatePm of changes.paymentMethods) {
          const idx = resultingMethods.findIndex((pm) => pm.method === updatePm.method);
          // `null` clears the transfer details, so only `undefined` keeps the current ones.
          const alias = updatePm.alias !== undefined ? updatePm.alias : (idx >= 0 ? resultingMethods[idx]!.alias : null);
          const holderName = updatePm.holderName !== undefined ? updatePm.holderName : (idx >= 0 ? resultingMethods[idx]!.holderName : null);
          const mergedItem: PaymentMethodSetting = {
            method: updatePm.method,
            enabled: updatePm.enabled,
            alias,
            holderName,
          };
          if (idx >= 0) {
            resultingMethods[idx] = mergedItem;
          } else {
            resultingMethods.push(mergedItem);
          }
        }
      }

      const resulting: StoreSettings = {
        acceptingOrders: changes.acceptingOrders ?? current.acceptingOrders,
        // `null` clears the minimum, so only `undefined` keeps the current one.
        minOrderCents: changes.minOrderCents !== undefined ? changes.minOrderCents : current.minOrderCents,
        shippingCents: changes.shippingCents ?? current.shippingCents,
        paymentMethods: resultingMethods,
      };

      const problem = settingsProblem(resulting, { transferDetails: changes.paymentMethods !== undefined });
      if (problem) {
        throw new ValidationError(problem.message);
      }

      return settingsRepo.upsertSettings(restaurant.id, resulting, now());
    },
  };
}

export function settingsServiceFor(db: D1Database): SettingsService {
  return createSettingsService(createRestaurantsRepository(db), createSettingsRepository(db));
}
