import type { PermissionKey } from "@menucito/shared";

/** What each route of the owner's API declares: a permission key, `owner` (owner only), `member` (any member) or `courier` (a member marked as a courier). */
export type Declared = PermissionKey | "owner" | "member" | "courier";

export interface RouteExpectation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Hono path pattern, as registered on the app. */
  pattern: string;
  /** A concrete URL to call it with (ids do not need to exist: the guard answers before any lookup). */
  url: string;
  declared: Declared;
}

const route = (method: RouteExpectation["method"], pattern: string, declared: Declared): RouteExpectation => ({
  method,
  pattern,
  url: pattern.replace(/:[A-Za-z]+/g, "some-id"),
  declared,
});

/** Decision 2 of spec 12 as a table: the single source the access tests and the coverage test share. */
export const OWNER_ROUTES: readonly RouteExpectation[] = [
  route("GET", "/api/restaurants/me", "member"),
  route("PUT", "/api/restaurants/me/plan", "owner"),
  route("PATCH", "/api/restaurants/me/appearance", "store.edit"),
  route("GET", "/api/restaurants/me/settings", "store.view"),
  route("PATCH", "/api/restaurants/me/settings", "store.edit"),
  route("GET", "/api/restaurants/me/location", "store.view"),
  route("PUT", "/api/restaurants/me/location", "store.edit"),
  route("GET", "/api/restaurants/me/delivery-zones", "store.view"),
  route("PUT", "/api/restaurants/me/delivery-zones", "store.edit"),
  route("GET", "/api/restaurants/me/hours", "store.view"),
  route("PUT", "/api/restaurants/me/hours", "store.edit"),
  route("GET", "/api/restaurants/me/places/search", "store.edit"),
  route("GET", "/api/restaurants/me/places/:placeId", "store.edit"),
  route("PUT", "/api/restaurants/me/logo", "store.edit"),
  route("DELETE", "/api/restaurants/me/logo", "store.edit"),
  route("PUT", "/api/restaurants/me/cover", "store.edit"),
  route("DELETE", "/api/restaurants/me/cover", "store.edit"),

  route("GET", "/api/categories", "menu.view"),
  route("POST", "/api/categories", "menu.edit"),
  route("PUT", "/api/categories/order", "menu.edit"),
  route("PATCH", "/api/categories/:id", "menu.edit"),
  route("DELETE", "/api/categories/:id", "menu.edit"),
  route("PUT", "/api/categories/:id/featured", "menu.edit"),
  route("PUT", "/api/categories/:id/products/order", "menu.edit"),

  route("POST", "/api/products", "menu.edit"),
  route("GET", "/api/products/:id", "menu.view"),
  route("PATCH", "/api/products/:id", "menu.edit"),
  route("DELETE", "/api/products/:id", "menu.edit"),
  route("PUT", "/api/products/:id/ingredients", "menu.edit"),
  route("PUT", "/api/products/:id/photo", "menu.edit"),
  route("DELETE", "/api/products/:id/photo", "menu.edit"),

  route("GET", "/api/orders", "orders.view"),
  route("POST", "/api/orders", "orders.create"),
  route("GET", "/api/orders/export", "orders.export"),
  route("GET", "/api/orders/totals", "summary.view"),
  route("GET", "/api/orders/places/search", "orders.create"),
  route("GET", "/api/orders/places/:placeId", "orders.create"),
  route("POST", "/api/orders/delivery-quote", "orders.create"),
  route("GET", "/api/orders/:id", "orders.view"),
  route("PATCH", "/api/orders/:id/status", "orders.status"),
  route("PATCH", "/api/orders/:id/payment", "orders.payment"),
  route("PATCH", "/api/orders/:id/payment-method", "orders.payment"),
  route("POST", "/api/orders/:id/assign", "orders.assign"),
  route("GET", "/api/order-messages", "orders.settings"),
  route("PUT", "/api/order-messages", "orders.settings"),

  route("GET", "/api/customers", "customers.view"),
  route("GET", "/api/customers/export.csv", "customers.export"),
  route("GET", "/api/customers/heatmap", "customers.view"),
  route("POST", "/api/customers/import", "customers.edit"),
  route("GET", "/api/customers/:id", "customers.view"),
  route("GET", "/api/customers/:id/orders", "customers.view"),
  route("PATCH", "/api/customers/:id", "customers.edit"),
  route("DELETE", "/api/customers/:id", "customers.delete"),
  route("DELETE", "/api/customers/:id/addresses/:addressId", "customers.edit"),
  route("GET", "/api/customer-tags", "customers.view"),
  route("POST", "/api/customer-tags", "customers.edit"),
  route("PATCH", "/api/customer-tags/:id", "customers.edit"),
  route("DELETE", "/api/customer-tags/:id", "customers.edit"),

  route("GET", "/api/cash-sessions/current", "cash.view"),
  route("POST", "/api/cash-sessions", "cash.open"),
  route("POST", "/api/cash-sessions/current/movements", "cash.movements"),
  route("PATCH", "/api/cash-sessions/current/movements/:id", "cash.movements"),
  route("POST", "/api/cash-sessions/current/movements/:id/void", "cash.movements"),
  route("POST", "/api/cash-sessions/current/settlements", "cash.settle"),
  route("DELETE", "/api/cash-sessions/current/settlements/:orderId", "cash.settle"),
  route("POST", "/api/cash-sessions/current/courier-change", "cash.settle"),
  route("POST", "/api/cash-sessions/current/close", "cash.close"),
  route("GET", "/api/cash-sessions", "cash.history"),
  route("GET", "/api/cash-sessions/:id", "cash.history"),

  route("GET", "/api/couriers", "orders.assign"),
  route("GET", "/api/couriers/summary", "couriers.view"),

  route("GET", "/api/deliveries", "courier"),
  route("GET", "/api/deliveries/summary", "courier"),
  route("POST", "/api/deliveries/:id/delivered", "courier"),

  route("GET", "/api/members", "owner"),
  route("POST", "/api/members", "owner"),
  route("PATCH", "/api/members/:id", "owner"),
  route("PATCH", "/api/members/:id/active", "owner"),
  route("PUT", "/api/members/:id/password", "owner"),
  route("DELETE", "/api/members/:id", "owner"),

  route("GET", "/api/roles", "owner"),
  route("POST", "/api/roles", "owner"),
  route("PATCH", "/api/roles/:id", "owner"),
  route("DELETE", "/api/roles/:id", "owner"),

  route("GET", "/api/reports/meta", "stats.view"),
  route("GET", "/api/reports/evolution", "stats.tab.evolution"),
  route("GET", "/api/reports/billing", "stats.tab.billing"),
  route("GET", "/api/reports/sales", "stats.tab.sales"),
  route("GET", "/api/reports/couriers", "stats.tab.couriers"),
  route("GET", "/api/reports/cash", "stats.tab.cash"),
];

/**
 * Routes that need a session only, by design: onboarding runs before the user has a restaurant, and the
 * rest of the app is public or handled by Better Auth.
 */
export const SESSION_ONLY_ROUTES: readonly string[] = [
  "GET /api/restaurants/slug-available",
  "POST /api/restaurants",
];

/** Route prefixes that are not the owner's API (no member check applies). */
export const NON_OWNER_PREFIXES: readonly string[] = ["/health", "/api/auth", "/api/public", "/api/media"];
