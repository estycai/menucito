import type { Ingredient } from "./catalog";

/**
 * Public, read-only menu of a restaurant, as returned by `GET /api/public/menus/:slug`.
 * Deliberately minimal: no owner, plan, status, WhatsApp or timestamps. The only ids are the ones of
 * the products, which are opaque and are the cart's keys.
 */
export interface PublicMenuProduct {
  /** Opaque product id; the web cart uses it as the key. */
  id: string;
  name: string;
  /** Empty string when the product has no description. */
  description: string;
  /** Price in ARS cents (integer). */
  priceCents: number;
  /** Public path of the photo (served by `GET /api/media/*`), or `null`. */
  imageUrl: string | null;
  /** `false` means "Agotado" (sold out); the product is still listed. */
  available: boolean;
  /**
   * Customizable ingredients in display order. Always empty unless the restaurant's plan includes
   * customizable ingredients, even when some were saved before a downgrade.
   */
  ingredients: Ingredient[];
}

export interface PublicMenuCategory {
  name: string;
  /** Never empty: categories without products are left out of the public menu. */
  products: PublicMenuProduct[];
}

export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    /** Public path of the logo (served by `GET /api/media/*`), or `null`. */
    logoUrl: string | null;
    /** Whether the restaurant delivers orders. */
    delivery: boolean;
    /** Whether orders can be picked up at the restaurant. */
    takeaway: boolean;
  };
  categories: PublicMenuCategory[];
}
