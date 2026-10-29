/**
 * Public, read-only menu of a restaurant, as returned by `GET /api/public/menus/:slug`.
 * Deliberately minimal: no ids, owner, plan, status, WhatsApp, timestamps or ingredients.
 */
export interface PublicMenuProduct {
  name: string;
  /** Empty string when the product has no description. */
  description: string;
  /** Price in ARS cents (integer). */
  priceCents: number;
  /** Public path of the photo (served by `GET /api/media/*`), or `null`. */
  imageUrl: string | null;
  /** `false` means "Agotado" (sold out); the product is still listed. */
  available: boolean;
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
  };
  categories: PublicMenuCategory[];
}
