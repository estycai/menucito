import { z } from "zod";
import { PAYMENT_METHODS, type PaymentMethod } from "./order";

export const ALIAS_MAX_LENGTH = 40;
export const HOLDER_NAME_MAX_LENGTH = 60;
export const MIN_ORDER_CENTS_MIN = 1;
export const MAX_MONEY_CENTS = 100_000_000;

export const SETTINGS_MESSAGES = {
  atLeastOnePaymentMethod: "Elegí al menos una forma de pago",
  transferAliasRequired: "Ingresá el alias de la cuenta",
  transferAliasTooLong: `El alias puede tener hasta ${ALIAS_MAX_LENGTH} caracteres`,
  transferHolderRequired: "Ingresá el titular de la cuenta",
  transferHolderTooLong: `El titular puede tener hasta ${HOLDER_NAME_MAX_LENGTH} caracteres`,
  minOrderInvalid: "El pedido mínimo debe ser un número entero positivo de hasta $1.000.000",
  shippingInvalid: "El costo de envío debe ser de hasta $1.000.000",
  emptyUpdate: "Enviá al menos un cambio",
} as const;

export interface PaymentMethodSetting {
  method: PaymentMethod;
  enabled: boolean;
  alias: string | null;
  holderName: string | null;
}

export interface StoreSettings {
  acceptingOrders: boolean;
  minOrderCents: number | null;
  shippingCents: number;
  paymentMethods: PaymentMethodSetting[];
}

export const DEFAULT_SETTINGS: StoreSettings = {
  acceptingOrders: true,
  minOrderCents: null,
  shippingCents: 0,
  paymentMethods: [
    { method: "cash", enabled: true, alias: null, holderName: null },
    { method: "transfer", enabled: false, alias: null, holderName: null },
  ],
};

export interface SettingsProblem {
  field: "paymentMethods" | "alias" | "holderName" | "minOrderCents" | "shippingCents";
  message: string;
}

export interface SettingsProblemOptions {
  /**
   * Whether an enabled `transfer` must carry alias and holder. Only when the change touches the payment
   * methods: a store backfilled with `transfer` enabled and no data can still change its minimum or
   * shipping (scenario 48). Defaults to true.
   */
  transferDetails?: boolean;
}

export function settingsProblem(
  state: StoreSettings,
  { transferDetails = true }: SettingsProblemOptions = {},
): SettingsProblem | null {
  if (!state.paymentMethods.some((pm) => pm.enabled)) {
    return { field: "paymentMethods", message: SETTINGS_MESSAGES.atLeastOnePaymentMethod };
  }

  const transfer = state.paymentMethods.find((pm) => pm.method === "transfer");
  if (transferDetails && transfer && transfer.enabled) {
    const alias = transfer.alias?.trim() ?? "";
    if (alias.length === 0) {
      return { field: "alias", message: SETTINGS_MESSAGES.transferAliasRequired };
    }
    if (alias.length > ALIAS_MAX_LENGTH) {
      return { field: "alias", message: SETTINGS_MESSAGES.transferAliasTooLong };
    }
    const holder = transfer.holderName?.trim() ?? "";
    if (holder.length === 0) {
      return { field: "holderName", message: SETTINGS_MESSAGES.transferHolderRequired };
    }
    if (holder.length > HOLDER_NAME_MAX_LENGTH) {
      return { field: "holderName", message: SETTINGS_MESSAGES.transferHolderTooLong };
    }
  }

  if (state.minOrderCents !== null) {
    if (
      !Number.isInteger(state.minOrderCents) ||
      state.minOrderCents < MIN_ORDER_CENTS_MIN ||
      state.minOrderCents > MAX_MONEY_CENTS
    ) {
      return { field: "minOrderCents", message: SETTINGS_MESSAGES.minOrderInvalid };
    }
  }

  if (
    !Number.isInteger(state.shippingCents) ||
    state.shippingCents < 0 ||
    state.shippingCents > MAX_MONEY_CENTS
  ) {
    return { field: "shippingCents", message: SETTINGS_MESSAGES.shippingInvalid };
  }

  return null;
}

export const updatePaymentMethodSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  enabled: z.boolean(),
  alias: z.string().trim().max(ALIAS_MAX_LENGTH, SETTINGS_MESSAGES.transferAliasTooLong).nullable().optional(),
  holderName: z.string().trim().max(HOLDER_NAME_MAX_LENGTH, SETTINGS_MESSAGES.transferHolderTooLong).nullable().optional(),
});

export const updateSettingsSchema = z
  .object({
    acceptingOrders: z.boolean().optional(),
    minOrderCents: z
      .number()
      .int(SETTINGS_MESSAGES.minOrderInvalid)
      .min(MIN_ORDER_CENTS_MIN, SETTINGS_MESSAGES.minOrderInvalid)
      .max(MAX_MONEY_CENTS, SETTINGS_MESSAGES.minOrderInvalid)
      .nullable()
      .optional(),
    shippingCents: z
      .number()
      .int(SETTINGS_MESSAGES.shippingInvalid)
      .min(0, SETTINGS_MESSAGES.shippingInvalid)
      .max(MAX_MONEY_CENTS, SETTINGS_MESSAGES.shippingInvalid)
      .optional(),
    paymentMethods: z.array(updatePaymentMethodSchema).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, SETTINGS_MESSAGES.emptyUpdate);

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
