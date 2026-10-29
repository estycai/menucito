import {
  FULFILLMENTS,
  ORDER_ADDRESS_MAX_LENGTH,
  ORDER_NAME_MAX_LENGTH,
  PAYMENT_METHODS,
  type Fulfillment,
  type PaymentMethod,
} from "@menucito/shared";
import type { StorageLike } from "./cart-store";

/** What the diner typed; the choices are empty strings until picked. */
export interface OrderFormValues {
  name: string;
  fulfillment: Fulfillment | "";
  address: string;
  payment: PaymentMethod | "";
}

export const EMPTY_ORDER_FORM: OrderFormValues = { name: "", fulfillment: "", address: "", payment: "" };

export const ORDER_FORM_STORAGE_VERSION = 1;

/** The form is remembered per restaurant, like the cart (the cart itself is never part of it). */
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
): OrderFormValues {
  try {
    const raw = storage?.getItem(orderFormStorageKey(slug));
    if (!raw) return EMPTY_ORDER_FORM;
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.v !== ORDER_FORM_STORAGE_VERSION) return EMPTY_ORDER_FORM;
    const fulfillment = oneOf(offered, data.fulfillment);
    return {
      name: typeof data.name === "string" ? data.name.slice(0, ORDER_NAME_MAX_LENGTH) : "",
      fulfillment,
      address: typeof data.address === "string" ? data.address.slice(0, ORDER_ADDRESS_MAX_LENGTH) : "",
      payment: oneOf(PAYMENT_METHODS, data.payment),
    };
  } catch {
    return EMPTY_ORDER_FORM;
  }
}

export function writeOrderForm(storage: StorageLike | null, slug: string, values: OrderFormValues): void {
  try {
    storage?.setItem(orderFormStorageKey(slug), JSON.stringify({ v: ORDER_FORM_STORAGE_VERSION, ...values }));
  } catch {
    // Storage is full or blocked: the form still works, it is just not remembered.
  }
}

/** The fulfillment options a restaurant offers, in display order. */
export function offeredFulfillments(restaurant: { takeaway: boolean; delivery: boolean }): Fulfillment[] {
  return FULFILLMENTS.filter((fulfillment) => restaurant[fulfillment]);
}
