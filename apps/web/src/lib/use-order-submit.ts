import { useRef, useState } from "preact/hooks";
import type { CreateOrderRequest, CreateOrderResponse, PublicMenu } from "@menucito/shared";
import { browserStorage, type CartStore } from "./cart-store";
import { toCatalog } from "./catalog";
import { ORDER_SUBMIT_MESSAGES, orderFailureAction, refreshMenu, submitOrder } from "./order-api";
import { clearToken, getOrCreateToken } from "./order-attempt";

export interface UseOrderSubmitOptions {
  slug: string;
  apiUrl: string;
  cart: CartStore;
  /** Adopts the rules of a menu fetched without cache after a conflict. */
  onMenu: (menu: PublicMenu) => void;
  /** The store stopped taking orders. */
  onPaused: () => void;
  /** The store no longer accepts the chosen payment method or fulfillment. */
  onChoiceRejected: (field: "payment" | "fulfillment") => void;
  /** No delivery zone covers the chosen address. */
  onOutOfCoverage: () => void;
}

export interface OrderSubmit {
  submitting: boolean;
  submitError: string | null;
  successOrder: CreateOrderResponse | null;
  /** The cart was reconciled with a fresh menu after a price or availability conflict. */
  menuRefreshed: boolean;
  /** True while a request is on its way, even before the next render shows `submitting`. */
  isSending: () => boolean;
  clearError: () => void;
  dismissMenuRefreshed: () => void;
  /** Sends the order built for this attempt's idempotency token; ignored while one is on its way. */
  send: (build: (clientOrderId: string) => CreateOrderRequest) => Promise<void>;
}

/** Order submission and failure handling (scenarios 58 to 61). Nothing is resent automatically. */
export function useOrderSubmit({
  slug,
  apiUrl,
  cart,
  onMenu,
  onPaused,
  onChoiceRejected,
  onOutOfCoverage,
}: UseOrderSubmitOptions): OrderSubmit {
  // A double tap or a double Enter must send a single request (scenario 60).
  const inFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<CreateOrderResponse | null>(null);
  const [menuRefreshed, setMenuRefreshed] = useState(false);

  /** Fetches the menu without cache and adopts its rules; `null` when it could not be read. */
  const adoptFreshMenu = async (): Promise<PublicMenu | null> => {
    const menu = await refreshMenu(apiUrl, slug);
    if (menu) onMenu(menu);
    return menu;
  };

  /** Reacts to a rejected order (scenario 61). */
  const handleFailure = async (failure: { status: number; code: string }) => {
    const action = orderFailureAction(failure);
    switch (action.kind) {
      case "refreshMenu": {
        const menu = await adoptFreshMenu();
        if (!menu) {
          setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
          return;
        }
        cart.reconcile(toCatalog(menu));
        setMenuRefreshed(true);
        return;
      }
      case "paused":
        onPaused();
        return;
      case "belowMinimum":
        if (!(await adoptFreshMenu())) setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
        return;
      case "refreshPaymentMethods":
      case "refreshFulfillments": {
        const menu = await adoptFreshMenu();
        onChoiceRejected(action.kind === "refreshPaymentMethods" ? "payment" : "fulfillment");
        if (!menu) setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
        return;
      }
      case "outOfCoverage":
        onOutOfCoverage();
        return;
      case "message":
        setSubmitError(action.message);
        return;
    }
  };

  const send = async (build: (clientOrderId: string) => CreateOrderRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setMenuRefreshed(false);
    try {
      const storage = browserStorage();
      const result = await submitOrder(apiUrl, slug, build(getOrCreateToken(storage, slug)));
      if (result.ok) {
        // The confirmation counts down and then opens WhatsApp (or the customer taps the button).
        setSuccessOrder(result.data);
        clearToken(storage, slug);
        cart.clear();
        return;
      }
      await handleFailure(result);
    } catch {
      // A failed reconcile or refresh must still leave the diner a way forward.
      setSubmitError(ORDER_SUBMIT_MESSAGES.retry);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return {
    submitting,
    submitError,
    successOrder,
    menuRefreshed,
    isSending: () => inFlight.current,
    clearError: () => setSubmitError(null),
    dismissMenuRefreshed: () => setMenuRefreshed(false),
    send,
  };
}
