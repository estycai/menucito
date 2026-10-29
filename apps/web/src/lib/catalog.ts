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

/** Every product of the menu (sold out ones included, so a stored cart can be reconciled against them). */
export function toCatalog(menu: PublicMenu): CatalogProduct[] {
  return menu.categories.flatMap((category) => category.products.map(toCatalogProduct));
}
