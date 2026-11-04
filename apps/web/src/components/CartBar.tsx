import { useMemo } from "preact/hooks";
import { CART_MESSAGES, cartItemCount, cartTotalCents, formatArs } from "@menucito/shared";
import type { CatalogProduct } from "../lib/catalog";
import { useCart } from "../lib/use-cart";
import { useMenuHours } from "../lib/use-menu-hours";

interface CartBarProps {
  slug: string;
  /** The whole current menu: the cart is reconciled against it and priced with it. */
  products: CatalogProduct[];
}

/**
 * Sticky bar with the cart summary and the link to the order detail; hidden while the cart is empty.
 * While the store is closed and takes no orders it keeps the summary but stops linking to the order.
 */
export function CartBar({ slug, products }: CartBarProps) {
  const { state, store } = useCart(slug, products);
  const closed = useMenuHours()?.canOrder === false;
  const priced = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const count = cartItemCount(state.lines);
  const total = cartTotalCents(state.lines, priced);
  if (!state.notice && count === 0) return null;
  const summary = `Ver pedido · ${count} ${count === 1 ? "producto" : "productos"} · ${formatArs(total)}`;

  return (
    <div class="cart-dock">
      {state.notice && (
        <div class="cart-notice" role="status">
          <p>{CART_MESSAGES.menuChanged}</p>
          <button type="button" class="text-button" onClick={() => store.dismissNotice()}>
            Entendido
          </button>
        </div>
      )}
      {count > 0 && (
        <div class="cart-bar">
          {closed ? (
            <p class="cart-bar-link is-disabled">
              <span aria-live="polite" aria-atomic="true">
                {summary}
              </span>
            </p>
          ) : (
            <a class="cart-bar-link" href={`/${slug}/pedido`}>
              <span aria-live="polite" aria-atomic="true">
                {summary}
              </span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
