import type { MenuProduct, PublicMenu, PublicMenuProduct } from "@menucito/shared";

/** A product as the islands need it: what the cart prices, plus the name to show. */
export interface CatalogProduct extends MenuProduct {
  name: string;
}

/** The fields of a public product that the islands need. */
export function toCatalogProduct(product: PublicMenuProduct): CatalogProduct {
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    available: product.available,
    ingredients: product.ingredients,
  };
}

/**
 * Every product of the menu, the featured ones included (they are not repeated in `categories`).
 * Sold out ones stay, so a stored cart can be reconciled against them.
 */
export function toCatalog(menu: PublicMenu): CatalogProduct[] {
  const categories = menu.featured ? [menu.featured, ...menu.categories] : menu.categories;
  return categories.flatMap((category) => category.products.map(toCatalogProduct));
}
