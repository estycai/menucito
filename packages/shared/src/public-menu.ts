import type { Ingredient } from "./catalog";
import type { DeliveryMode, LatLng } from "./delivery";
import type { HoursSlot } from "./hours";
import type { PaymentMethod } from "./order";

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

export interface PublicMenuPaymentMethod {
  method: PaymentMethod;
  alias: string | null;
  holderName: string | null;
}

export interface PublicMenuRestaurant {
  name: string;
  slug: string;
  /** Public path of the logo (served by `GET /api/media/*`), or `null`. */
  logoUrl: string | null;
  /** Whether the restaurant delivers orders. */
  delivery: boolean;
  /** Whether orders can be picked up at the restaurant. */
  takeaway: boolean;
  /** Public path of the cover (served by `GET /api/media/*`), or `null`. */
  coverUrl: string | null;
  /** Short description; empty string when there is none. */
  description: string;
  /**
   * Colors to render with, always `#RRGGBB`: the saved ones on plans with `customColors`, the
   * Menucito defaults otherwise (or where nothing was saved).
   */
  colors: { background: string; primary: string };
  /** Whether the store is currently accepting orders. */
  acceptingOrders: boolean;
  /**
   * Opening hours (Argentina time), to compute with `hoursStatus` whether orders are taken now. Empty
   * when the store has not set hours: then it is treated as always open.
   */
  hours: HoursSlot[];
  /** With hours set and the store closed: whether orders are still taken (prepared when it opens). */
  acceptOrdersOutsideHours: boolean;
  /** Minimum order in ARS cents, or `null` if none. */
  minOrderCents: number | null;
  /** Shipping cost in ARS cents (`flat` mode; in `zones` mode the address quote prices it). */
  shippingCents: number;
  /**
   * `flat`: the diner types the address and pays `shippingCents`. `zones`: the diner picks a geocoded
   * address and the API quotes it (`POST .../delivery-quote`).
   */
  deliveryMode: DeliveryMode;
  /** Where the store is, to center the address map; set only in `zones` mode. Never the zones. */
  location: LatLng | null;
  /** Enabled payment methods. */
  paymentMethods: PublicMenuPaymentMethod[];
}

export interface PublicMenu {
  restaurant: PublicMenuRestaurant;
  /** The featured category, shown first. `null` when none is set or it has no products. */
  featured: PublicMenuCategory | null;
  /** Every other category with products; never includes the featured one. */
  categories: PublicMenuCategory[];
}
