import {
  DEFAULT_SETTINGS,
  settingsProblem,
  type PaymentMethodSetting,
  type StoreSettings,
  type UpdateSettingsInput,
} from "@menucito/shared";
import { createSettingsRepository, type SettingsRepository } from "../repositories/settings";
import { ValidationError } from "./errors";

export interface SettingsService {
  getSettings(restaurantId: string): Promise<StoreSettings>;
  updateSettings(restaurantId: string, changes: UpdateSettingsInput): Promise<StoreSettings>;
}

export function createSettingsService(
  settingsRepo: SettingsRepository,
  now: () => Date = () => new Date(),
): SettingsService {
  return {
    async getSettings(restaurantId: string): Promise<StoreSettings> {
      const settings = await settingsRepo.findSettings(restaurantId);
      if (!settings) {
        console.warn(`[settings] restaurant ${restaurantId} missing settings row, using safe defaults`);
        return DEFAULT_SETTINGS;
      }

      return settings;
    },

    async updateSettings(restaurantId: string, changes: UpdateSettingsInput): Promise<StoreSettings> {
      let current = await settingsRepo.findSettings(restaurantId);
      if (!current) {
        console.warn(`[settings] restaurant ${restaurantId} missing settings row on update, using safe defaults`);
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
        acceptOrdersOutsideHours: changes.acceptOrdersOutsideHours ?? current.acceptOrdersOutsideHours,
        // `null` clears the minimum, so only `undefined` keeps the current one.
        minOrderCents: changes.minOrderCents !== undefined ? changes.minOrderCents : current.minOrderCents,
        shippingCents: changes.shippingCents ?? current.shippingCents,
        paymentMethods: resultingMethods,
      };

      const problem = settingsProblem(resulting, { transferDetails: changes.paymentMethods !== undefined });
      if (problem) {
        throw new ValidationError(problem.message);
      }

      return settingsRepo.upsertSettings(restaurantId, resulting, now());
    },
  };
}

export function settingsServiceFor(db: D1Database): SettingsService {
  return createSettingsService(createSettingsRepository(db));
}
