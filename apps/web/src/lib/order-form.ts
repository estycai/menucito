import {
  CASH_TENDERED_MAX_CENTS,
  DELIVERY_ADDRESS_MESSAGES,
  FULFILLMENTS,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_MESSAGES,
  ORDER_NAME_MAX_LENGTH,
  ORDERS_MESSAGES,
  PAYMENT_METHODS,
  PAYMENT_SPLIT_MESSAGES,
  normalizeArWhatsapp,
  splitCashProblem,
  type Fulfillment,
  type OrderDelivery,
  type PaymentMethod,
} from "@menucito/shared";
import type { StorageLike } from "./cart-store";

/** What the diner typed; the choices are empty strings until picked. */
export interface OrderFormValues {
  name: string;
  phone: string;
  fulfillment: Fulfillment | "";
  address: string;
  payment: PaymentMethod | "";
  /** Cash part of a split payment, in whole pesos as typed. */
  splitCash: string;
  /** "¿Con cuánto abonás?", in whole pesos as typed. */
  cashTendered: string;
}

export const EMPTY_ORDER_FORM: OrderFormValues = {
  name: "",
  phone: "",
  fulfillment: "",
  address: "",
  payment: "",
  splitCash: "",
  cashTendered: "",
};

export const ORDER_FORM_STORAGE_VERSION = 1;

/**
 * The form is remembered per restaurant, like the cart (the cart itself is never part of it). The
 * address never is: the diner types it every time (the store keeps the ones that ordered).
 */
export const orderFormStorageKey = (slug: string) => `menucito:order-form:${slug}`;

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | "" =>
  values.find((candidate) => candidate === value) ?? "";

/**
 * Reads the remembered form. Anything missing, corrupt or no longer valid (a choice the restaurant
 * stopped offering, text over the limits) falls back to empty instead of throwing.
 */
export function readOrderForm(
  storage: StorageLike | null,
  slug: string,
  offered: readonly Fulfillment[] = FULFILLMENTS,
  offeredMethods: readonly PaymentMethod[] = PAYMENT_METHODS,
): OrderFormValues {
  try {
    const raw = storage?.getItem(orderFormStorageKey(slug));
    if (!raw) return EMPTY_ORDER_FORM;
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.v !== ORDER_FORM_STORAGE_VERSION) return EMPTY_ORDER_FORM;
    const fulfillment = oneOf(offered, data.fulfillment);
    const payment = oneOf(offeredMethods, data.payment);
    return {
      name: typeof data.name === "string" ? data.name.slice(0, ORDER_NAME_MAX_LENGTH) : "",
      phone: typeof data.phone === "string" ? data.phone.slice(0, 30) : "",
      fulfillment,
      address: "",
      payment,
      splitCash: "",
      cashTendered: "",
    };
  } catch {
    return EMPTY_ORDER_FORM;
  }
}

export function writeOrderForm(storage: StorageLike | null, slug: string, values: OrderFormValues): void {
  try {
    const { name, phone, fulfillment, payment } = values;
    storage?.setItem(orderFormStorageKey(slug), JSON.stringify({ v: ORDER_FORM_STORAGE_VERSION, name, phone, fulfillment, payment }));
  } catch {
    // Storage is full or blocked: the form still works, it is just not remembered.
  }
}

/** The fulfillment options a restaurant offers, in display order. */
export function offeredFulfillments(restaurant: { takeaway: boolean; delivery: boolean }): Fulfillment[] {
  return FULFILLMENTS.filter((fulfillment) => restaurant[fulfillment]);
}

/** The payment methods a restaurant offers, in display order. */
export function offeredPaymentMethods(restaurant: { paymentMethods: Array<{ method: PaymentMethod }> }): PaymentMethod[] {
  return restaurant.paymentMethods.map((p) => p.method);
}

export type OrderFormField =
  | "name"
  | "phone"
  | "fulfillment"
  | "address"
  | "payment"
  | "splitCash"
  | "cashTendered";

export type OrderFormErrors = Partial<Record<OrderFormField, string>>;

/**
 * Whole pesos typed in a cash field, in cents: `undefined` when empty, `null` when it is not a whole
 * number. The cap is checked by the caller, which also knows the cash part it must cover.
 */
export function pesosInputCents(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed) * 100;
}

/** The cash part the diner must cover when paying in cash or splitting the payment. */
export function cashPartCents(
  values: Pick<OrderFormValues, "payment" | "splitCash">,
  totalCents: number,
): number | null {
  if (values.payment === "cash") return totalCents;
  if (values.payment !== "split") return null;
  const split = pesosInputCents(values.splitCash);
  return typeof split === "number" ? split : null;
}

/**
 * Validates the form against what the restaurant offers; an empty object means it can be sent. In
 * `zones` mode pass the chosen geocoded address (or `null`): it replaces the typed one. `amounts` is
 * the order total (and its tip, which always goes by transfer), needed by the split and "¿Con cuánto
 * abonás?" fields.
 */
export function getFormErrors(
  values: OrderFormValues,
  offered: readonly Fulfillment[],
  offeredMethods: readonly PaymentMethod[],
  zones?: { address: OrderDelivery | null },
  amounts?: { totalCents: number; tipCents?: number },
): OrderFormErrors {
  const errors: OrderFormErrors = {};

  const trimmedName = values.name.trim();
  if (!trimmedName) {
    errors.name = ORDER_MESSAGES.nameRequired;
  } else if (trimmedName.length > ORDER_NAME_MAX_LENGTH) {
    errors.name = ORDER_MESSAGES.nameTooLong;
  }

  const trimmedPhone = values.phone.trim();
  if (!trimmedPhone) {
    errors.phone = ORDERS_MESSAGES.phoneRequired;
  } else if (!normalizeArWhatsapp(trimmedPhone)) {
    errors.phone = ORDERS_MESSAGES.phoneInvalid;
  }

  if (!values.fulfillment || !offered.includes(values.fulfillment)) {
    errors.fulfillment = ORDER_MESSAGES.fulfillmentRequired;
  }

  if (values.fulfillment === "delivery" && zones) {
    if (!zones.address) errors.address = DELIVERY_ADDRESS_MESSAGES.addressRequired;
  } else if (values.fulfillment === "delivery") {
    const trimmedAddress = values.address.trim();
    if (!trimmedAddress) {
      errors.address = ORDER_MESSAGES.addressRequired;
    } else if (trimmedAddress.length > ORDER_ADDRESS_MAX_LENGTH) {
      errors.address = ORDER_MESSAGES.addressTooLong;
    }
  }

  if (!values.payment || !offeredMethods.includes(values.payment)) {
    errors.payment = ORDER_MESSAGES.paymentRequired;
  }

  const totalCents = amounts?.totalCents ?? 0;
  const splitCents = pesosInputCents(values.splitCash);
  if (values.payment === "split") {
    if (!values.splitCash.trim()) {
      errors.splitCash = PAYMENT_SPLIT_MESSAGES.splitRequired;
    } else if (typeof splitCents !== "number") {
      errors.splitCash = PAYMENT_SPLIT_MESSAGES.splitInvalid;
    } else {
      const splitProblem = splitCashProblem(splitCents, totalCents, amounts?.tipCents ?? 0);
      if (splitProblem) errors.splitCash = PAYMENT_SPLIT_MESSAGES[splitProblem];
    }
  }

  if (values.payment === "cash" || values.payment === "split") {
    const tenderedCents = pesosInputCents(values.cashTendered);
    if (tenderedCents === null) {
      errors.cashTendered = PAYMENT_SPLIT_MESSAGES.tenderedInvalid;
    } else if (tenderedCents !== undefined) {
      const cashCents = cashPartCents(values, totalCents);
      if (tenderedCents > CASH_TENDERED_MAX_CENTS) {
        errors.cashTendered = PAYMENT_SPLIT_MESSAGES.tenderedTooHigh;
      } else if (cashCents !== null && tenderedCents < cashCents) {
        errors.cashTendered = PAYMENT_SPLIT_MESSAGES.tenderedTooLow;
      }
    }
  }

  return errors;
}

/** Cents missing to reach the store minimum (scenario 56), or `null` when there is none or it is reached. */
export function minOrderShortfallCents(subtotalCents: number, minOrderCents: number | null): number | null {
  if (minOrderCents === null || subtotalCents >= minOrderCents) return null;
  return minOrderCents - subtotalCents;
}
