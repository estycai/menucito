import type { ApiErrorBody, CreateOrderRequest, CreateOrderResponse, PublicMenu } from "@menucito/shared";

export type SubmitOrderResult =
  | { ok: true; status: 200 | 201; data: CreateOrderResponse }
  | { ok: false; status: number; code: string; message?: string };

export async function submitOrder(
  apiUrl: string,
  slug: string,
  body: CreateOrderRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitOrderResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetchImpl(`${apiUrl}/api/public/menus/${slug}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Error de red",
    };
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
} as const;

/** What the order page does after a failed submission (scenarios 60 and 61). Nothing is resent automatically. */
export type OrderFailureAction =
  /** The menu changed: fetch it without cache, reconcile the cart and show the new total. */
  | { kind: "refreshMenu" }
  /** The store paused: show the pause banner. */
  | { kind: "paused" }
  /** The subtotal does not reach the minimum: show the minimum notice. */
  | { kind: "belowMinimum" }
  /** The chosen payment method is gone: refresh the methods and ask to choose again. */
  | { kind: "refreshPaymentMethods" }
  /** The chosen fulfillment is gone: refresh the fulfillments. */
  | { kind: "refreshFulfillments" }
  /** Anything else: show this message (never the raw server or network error). */
  | { kind: "message"; message: string };

export function orderFailureAction(failure: { status: number; code: string }): OrderFailureAction {
  switch (failure.code) {
    case "PRICE_CHANGED":
    case "PRODUCT_UNAVAILABLE":
      return { kind: "refreshMenu" };
    case "STORE_PAUSED":
      return { kind: "paused" };
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
