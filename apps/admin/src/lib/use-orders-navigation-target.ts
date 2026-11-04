import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ordersNavigationState, type OrdersNavigationState } from "./new-orders";

/**
 * Hands `onTarget` the target a new-order toast ("Ver pedido" / "Ver pedidos") navigated with:
 * once per navigation (during render, keyed by the location, so the page updates its own state
 * without an extra pass), then clears it from the history entry so a reload or going back does
 * not open it again.
 */
export function useOrdersNavigationTarget(onTarget: (target: OrdersNavigationState) => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const target = ordersNavigationState(location.state);
  const [handledLocationKey, setHandledLocationKey] = useState<string | null>(null);

  if (target && handledLocationKey !== location.key) {
    setHandledLocationKey(location.key);
    onTarget(target);
  }

  useEffect(() => {
    if (target) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }
  }, [target, location.pathname, location.search, navigate]);
}
