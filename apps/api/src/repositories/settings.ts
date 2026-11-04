import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentMethodSetting,
  type StoreSettings,
} from "@menucito/shared";
import { restaurantPaymentMethods, restaurantSettings } from "../db/schema";

export interface SettingsRepository {
  findSettings(restaurantId: string): Promise<StoreSettings | null>;
  /** Writes the full resulting settings (already merged and validated by the service). */
  upsertSettings(restaurantId: string, settings: StoreSettings, updatedAt: Date): Promise<StoreSettings>;
}

export function createSettingsRepository(d1: D1Database): SettingsRepository {
  const db = drizzle(d1);

  async function findSettings(restaurantId: string): Promise<StoreSettings | null> {
    const settingsRow = await db
      .select()
      .from(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, restaurantId))
      .get();

    if (!settingsRow) return null;

    const methodRows = await db
      .select()
      .from(restaurantPaymentMethods)
      .where(eq(restaurantPaymentMethods.restaurantId, restaurantId))
      .all();

    const methods: PaymentMethodSetting[] = methodRows.map((row) => ({
      method: row.method as PaymentMethod,
      enabled: Boolean(row.enabled),
      alias: row.alias,
      holderName: row.holderName,
    }));

    for (const m of PAYMENT_METHODS) {
      if (!methods.some((pm) => pm.method === m)) {
        methods.push({ method: m, enabled: false, alias: null, holderName: null });
      }
    }

    return {
      acceptingOrders: Boolean(settingsRow.acceptingOrders),
      acceptOrdersOutsideHours: Boolean(settingsRow.acceptOrdersOutsideHours),
      minOrderCents: settingsRow.minOrderCents,
      shippingCents: settingsRow.shippingCents,
      paymentMethods: methods,
    };
  }

  return {
    findSettings,

    async upsertSettings(restaurantId, settings, updatedAt) {
      const { acceptingOrders, acceptOrdersOutsideHours, minOrderCents, shippingCents } = settings;

      type BatchStatement = Parameters<typeof db.batch>[0][number];
      const batchStatements: BatchStatement[] = [
        db
          .insert(restaurantSettings)
          .values({ restaurantId, acceptingOrders, acceptOrdersOutsideHours, minOrderCents, shippingCents, updatedAt })
          .onConflictDoUpdate({
            target: restaurantSettings.restaurantId,
            set: { acceptingOrders, acceptOrdersOutsideHours, minOrderCents, shippingCents, updatedAt },
          }),
      ];

      for (const pm of settings.paymentMethods) {
        batchStatements.push(
          db
            .insert(restaurantPaymentMethods)
            .values({
              restaurantId,
              method: pm.method,
              enabled: pm.enabled,
              alias: pm.alias,
              holderName: pm.holderName,
            })
            .onConflictDoUpdate({
              target: [restaurantPaymentMethods.restaurantId, restaurantPaymentMethods.method],
              set: { enabled: pm.enabled, alias: pm.alias, holderName: pm.holderName },
            }),
        );
      }

      await db.batch(batchStatements as [BatchStatement, ...BatchStatement[]]);

      const updated = await findSettings(restaurantId);
      if (!updated) throw new Error("Settings disappeared right after update");
      return updated;
    },
  };
}
