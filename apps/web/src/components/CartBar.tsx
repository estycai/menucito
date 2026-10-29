import { useMemo } from "preact/hooks";
import { CART_MESSAGES, cartItemCount, cartTotalCents, formatArs } from "@menucito/shared";
import type { CatalogProduct } from "../lib/catalog";
import { useCart } from "../lib/use-cart";

interface CartBarProps {
  slug: string;
  /** The whole current menu: the cart is reconciled against it and priced with it. */
  products: CatalogProduct[];
}

/** Sticky bar with the cart summary and the link to the order detail; hidden while the cart is empty. */
export function CartBar({ slug, products }: CartBarProps) {
  const { state, store } = useCart(slug, products);
  const priced = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const count = cartItemCount(state.lines);
  const total = cartTotalCents(state.lines, priced);
  if (!state.notice && count === 0) return null;

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
          <a class="cart-bar-link" href={`/${slug}/pedido`}>
            <span aria-live="polite" aria-atomic="true">
              Ver pedido · {count} {count === 1 ? "producto" : "productos"} · {formatArs(total)}
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
