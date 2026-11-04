import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MAX_MONEY_CENTS,
  SETTINGS_MESSAGES,
  formatArs,
  parseArsPrice,
  type PaymentMethodSetting,
  type StoreSettings,
  type UpdateSettingsInput,
} from "@menucito/shared";
import { api } from "./restaurant";

export type { StoreSettings };

export const STORE_SETTINGS_KEY = ["restaurant", "settings"] as const;

export interface StoreSettingsValues {
  minOrder: string;
  shipping: string;
  cashEnabled: boolean;
  transferEnabled: boolean;
  transferAlias: string;
  transferHolderName: string;
}

export function valuesFromSettings(settings: StoreSettings): StoreSettingsValues {
  const cash = settings.paymentMethods.find((p) => p.method === "cash");
  const transfer = settings.paymentMethods.find((p) => p.method === "transfer");

  return {
    minOrder: settings.minOrderCents !== null ? formatArs(settings.minOrderCents).replace("$", "").trim() : "",
    shipping: formatArs(settings.shippingCents).replace("$", "").trim(),
    cashEnabled: cash?.enabled ?? true,
    transferEnabled: transfer?.enabled ?? false,
    transferAlias: transfer?.alias ?? "",
    transferHolderName: transfer?.holderName ?? "",
  };
}

/**
 * Fields edited by each card of "Mi local". A card keeps a draft of its own fields only and reads the
 * rest from the saved settings, so its save sends just its own changes.
 */
export const SETTINGS_SECTION_FIELDS = {
  minOrder: ["minOrder"],
  shipping: ["shipping"],
  payments: ["cashEnabled", "transferEnabled", "transferAlias", "transferHolderName"],
} as const satisfies Record<string, readonly (keyof StoreSettingsValues)[]>;

export type SettingsSection = keyof typeof SETTINGS_SECTION_FIELDS;
export type SectionValues<S extends SettingsSection> = Pick<StoreSettingsValues, (typeof SETTINGS_SECTION_FIELDS)[S][number]>;

export function sectionValues<S extends SettingsSection>(section: S, values: StoreSettingsValues): SectionValues<S> {
  const fields: readonly (keyof StoreSettingsValues)[] = SETTINGS_SECTION_FIELDS[section];
  return Object.fromEntries(fields.map((field) => [field, values[field]])) as SectionValues<S>;
}

export interface SettingsCheck {
  changes: UpdateSettingsInput | null;
  errors: {
    minOrder?: string;
    shipping?: string;
    methods?: string;
    transferAlias?: string;
    transferHolderName?: string;
  };
  hasIncompleteTransferWarning: boolean;
  invalid: boolean;
}

export function checkSettings(saved: StoreSettings, values: StoreSettingsValues): SettingsCheck {
  const changes: UpdateSettingsInput = {};
  const errors: SettingsCheck["errors"] = {};

  const currentCash = saved.paymentMethods.find((p) => p.method === "cash");
  const currentTransfer = saved.paymentMethods.find((p) => p.method === "transfer");

  // Warning if transfer is currently enabled but missing alias or holder (e.g. from migration backfill)
  const hasIncompleteTransferWarning = Boolean(
    currentTransfer?.enabled && (!currentTransfer.alias || !currentTransfer.holderName),
  );

  // 1. Min order
  let parsedMin: number | null = null;
  if (values.minOrder.trim() !== "") {
    parsedMin = parseArsPrice(values.minOrder);
    if (parsedMin === null || parsedMin <= 0 || parsedMin > MAX_MONEY_CENTS) {
      errors.minOrder = SETTINGS_MESSAGES.minOrderInvalid;
    }
  }
  if (!errors.minOrder && parsedMin !== saved.minOrderCents) {
    changes.minOrderCents = parsedMin;
  }

  // 2. Shipping
  let parsedShipping: number | null = null;
  if (values.shipping.trim() === "") {
    errors.shipping = "Ingresá el costo de envío (0 para gratis)";
  } else {
    parsedShipping = parseArsPrice(values.shipping);
    if (parsedShipping === null || parsedShipping < 0 || parsedShipping > MAX_MONEY_CENTS) {
      errors.shipping = SETTINGS_MESSAGES.shippingInvalid;
    }
  }
  if (!errors.shipping && parsedShipping !== null && parsedShipping !== saved.shippingCents) {
    changes.shippingCents = parsedShipping;
  }

  // 3. Payment methods
  if (!values.cashEnabled && !values.transferEnabled) {
    errors.methods = SETTINGS_MESSAGES.atLeastOnePaymentMethod;
  }

  const aliasTrimmed = values.transferAlias.trim();
  const holderTrimmed = values.transferHolderName.trim();

  // Did payment methods change?
  const cashChanged = (currentCash?.enabled ?? true) !== values.cashEnabled;
  const transferChanged =
    (currentTransfer?.enabled ?? false) !== values.transferEnabled ||
    (currentTransfer?.alias ?? "") !== (values.transferEnabled ? aliasTrimmed : "") ||
    (currentTransfer?.holderName ?? "") !== (values.transferEnabled ? holderTrimmed : "");
  const methodsChanged = cashChanged || transferChanged;

  // Alias and holder are required only when the change includes the payment methods: a backfilled
  // store (transfer enabled, no data) can still save its minimum or shipping (scenario 48).
  if (values.transferEnabled && methodsChanged) {
    if (!aliasTrimmed) {
      errors.transferAlias = SETTINGS_MESSAGES.transferAliasRequired;
    } else if (aliasTrimmed.length > 40) {
      errors.transferAlias = SETTINGS_MESSAGES.transferAliasTooLong;
    }
    if (!holderTrimmed) {
      errors.transferHolderName = SETTINGS_MESSAGES.transferHolderRequired;
    } else if (holderTrimmed.length > 60) {
      errors.transferHolderName = SETTINGS_MESSAGES.transferHolderTooLong;
    }
  }

  if (methodsChanged) {
    const methods: PaymentMethodSetting[] = [
      { method: "cash", enabled: values.cashEnabled, alias: null, holderName: null },
      {
        method: "transfer",
        enabled: values.transferEnabled,
        alias: values.transferEnabled ? aliasTrimmed : null,
        holderName: values.transferEnabled ? holderTrimmed : null,
      },
    ];
    changes.paymentMethods = methods;
  }

  const invalid = Object.keys(errors).length > 0;

  return {
    changes: !invalid && Object.keys(changes).length > 0 ? changes : null,
    errors,
    hasIncompleteTransferWarning,
    invalid,
  };
}

export function useStoreSettings() {
  return useQuery({
    queryKey: STORE_SETTINGS_KEY,
    queryFn: () => api<StoreSettings>("/api/restaurants/me/settings"),
  });
}

export function useUpdateStoreSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateSettingsInput) =>
      api<StoreSettings>("/api/restaurants/me/settings", {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(STORE_SETTINGS_KEY, updated);
      queryClient.invalidateQueries({ queryKey: STORE_SETTINGS_KEY });
    },
  });
}
