import type {
  ApiErrorBody,
  CartLine,
  CreateOrderRequestInput,
  CreateOrderResponse,
  OrderDelivery,
  PaymentMethod,
  PublicMenu,
} from "@menucito/shared";
import type { OrderFormValues } from "./order-form";
import { pesosInputCents } from "./order-form";

/** How long the order request (headers and body) may take before it counts as a network error. */
export const ORDER_SUBMIT_TIMEOUT_MS = 15000;

/**
 * The request body for a validated form (see `getFormErrors`). Text is trimmed and takeaway orders
 * never carry an address, even when the diner typed one before switching. A geocoded `delivery`
 * address (stores in `zones` mode) replaces the typed one. `tipCents` is the amount already rounded
 * to whole pesos by the tip selector; it must be part of `expectedTotalCents` (scenario 8) and is only
 * sent on a delivery paid by transfer, so cash and takeaway never carry the field at all.
 */
export function buildOrderRequest(
  values: OrderFormValues,
  lines: ReadonlyArray<Pick<CartLine, "productId" | "quantity" | "choices">>,
  clientOrderId: string,
  expectedTotalCents: number,
  delivery: OrderDelivery | null = null,
  tipCents = 0,
): CreateOrderRequestInput {
  const split = pesosInputCents(values.splitCash);
  const tendered = pesosInputCents(values.cashTendered);
  const common = {
    clientOrderId,
    paymentMethod: values.payment as PaymentMethod,
    expectedTotalCents,
    ...(values.payment === "split" && typeof split === "number" ? { splitCashCents: split } : {}),
    ...((values.payment === "cash" || values.payment === "split") && typeof tendered === "number"
      ? { cashTenderedCents: tendered }
      : {}),
    ...(values.fulfillment === "delivery" && (values.payment === "transfer" || values.payment === "split")
      ? { tipCents }
      : {}),
    items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, choices: { ...line.choices } })),
  };
  const name = values.name.trim();
  const phone = values.phone.trim();
  if (values.fulfillment !== "delivery") {
    return { ...common, fulfillment: "takeaway", customer: { name, phone, address: null }, delivery: null };
  }
  return delivery
    ? { ...common, fulfillment: "delivery", customer: { name, phone, address: null }, delivery: { ...delivery } }
    : { ...common, fulfillment: "delivery", customer: { name, phone, address: values.address.trim() }, delivery: null };
}

export type SubmitOrderResult =
  | { ok: true; status: 200 | 201; data: CreateOrderResponse }
  | { ok: false; status: number; code: string; message?: string };

export async function submitOrder(
  apiUrl: string,
  slug: string,
  body: CreateOrderRequestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitOrderResult> {
  const controller = new AbortController();
  // The abort stays armed until the body is read, so a stalled response body also times out.
  const timeoutId = setTimeout(() => controller.abort(), ORDER_SUBMIT_TIMEOUT_MS);

  try {
    const res = await fetchImpl(`${apiUrl}/api/public/menus/${slug}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as CreateOrderResponse;
      return { ok: true, status: res.status as 200 | 201, data };
    }

    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return {
      ok: false,
      status: res.status,
      code: err?.error?.code ?? (res.status === 413 ? "BODY_TOO_LARGE" : "UNKNOWN"),
      message: err?.error?.message,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Error de red",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function refreshMenu(
  apiUrl: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicMenu | null> {
  try {
    const res = await fetchImpl(`${apiUrl}/api/public/menus/${slug}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicMenu;
  } catch {
    return null;
  }
}

export const ORDER_SUBMIT_MESSAGES = {
  retry: "No pudimos enviar tu pedido. Probá de nuevo.",
  tooManyOrders: "Ya enviaste varios pedidos. Esperá unos minutos o escribile al local.",
  closed: "El local está cerrado ahora. Probá de nuevo cuando abra.",
} as const;

/** What the order page does after a failed submission (scenarios 60 and 61). Nothing is resent automatically. */
export type OrderFailureAction =
  /** The menu changed: fetch it without cache, reconcile the cart and show the new total. */
  | { kind: "refreshMenu" }
  /** The store paused: show the pause banner. */
  | { kind: "paused" }
  /** The store is outside its hours: fetch its current hours and show the closed notice. */
  | { kind: "closed" }
  /** The subtotal does not reach the minimum: show the minimum notice. */
  | { kind: "belowMinimum" }
  /** The chosen payment method is gone: refresh the methods and ask to choose again. */
  | { kind: "refreshPaymentMethods" }
  /** The chosen fulfillment is gone: refresh the fulfillments. */
  | { kind: "refreshFulfillments" }
  /** No delivery zone covers the address: explain it and offer takeaway or another address. */
  | { kind: "outOfCoverage" }
  /** Anything else: show this message (never the raw server or network error). */
  | { kind: "message"; message: string };

export function orderFailureAction(failure: { status: number; code: string }): OrderFailureAction {
  switch (failure.code) {
    // DELIVERY_LOCATION_REQUIRED: the store switched to zones while the page was open, so the fresh
    // menu brings the address card.
    case "PRICE_CHANGED":
    case "PRODUCT_UNAVAILABLE":
    case "DELIVERY_LOCATION_REQUIRED":
      return { kind: "refreshMenu" };
    case "OUT_OF_COVERAGE":
      return { kind: "outOfCoverage" };
    case "STORE_PAUSED":
      return { kind: "paused" };
    case "STORE_CLOSED":
      return { kind: "closed" };
    case "BELOW_MINIMUM":
      return { kind: "belowMinimum" };
    case "PAYMENT_METHOD_NOT_ACCEPTED":
      return { kind: "refreshPaymentMethods" };
    case "FULFILLMENT_NOT_OFFERED":
      return { kind: "refreshFulfillments" };
    case "TOO_MANY_ORDERS":
      return { kind: "message", message: ORDER_SUBMIT_MESSAGES.tooManyOrders };
    default:
      // 422, 404, 413, network error, timeout and 5xx all share the generic retry message.
      return { kind: "message", message: ORDER_SUBMIT_MESSAGES.retry };
  }
}
