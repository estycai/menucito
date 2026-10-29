import { useEffect, useState } from "preact/hooks";
import type { MenuProduct } from "@menucito/shared";
import { INITIAL_CART_STATE, cartStoreFor, type CartState, type CartStore } from "./cart-store";

/**
 * The cart of `slug` for an island. The first render always shows the empty cart (what the server
 * rendered); the stored one is read after hydration, so the HTML never mismatches. Pass `products`
 * (the current menu) from the island that should adapt the stored cart to it.
 */
export function useCart(slug: string, products?: readonly MenuProduct[]): { state: CartState; store: CartStore } {
  const store = cartStoreFor(slug);
  const [state, setState] = useState<CartState>(INITIAL_CART_STATE);

  useEffect(() => {
    store.load();
    if (products) store.reconcile(products);
    setState(store.getState());
    return store.subscribe(() => setState(store.getState()));
    // `products` is deliberately not a dependency: the menu is fixed for the lifetime of a page.
  }, [store]);

  return { state, store };
}
