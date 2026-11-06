import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Tables follow the Better Auth core schema (user, session, account, verification).

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// One restaurant per user for now (`owner_id` UNIQUE). `plan`/`status` values are provisional.
// `hours_json` comes in a later change.
export const restaurants = sqliteTable("restaurants", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  whatsapp: text("whatsapp").notNull(),
  delivery: integer("delivery", { mode: "boolean" }).notNull(),
  takeaway: integer("takeaway", { mode: "boolean" }).notNull(),
  plan: text("plan").notNull().default("basic"),
  status: text("status").notNull().default("trial"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// How the restaurant looks (1:1 with `restaurants`, created in the same batch as the restaurant).
// `logo_url` and `cover_url` hold the public path of the image (the R2 key is derived from it).
// `bg_color` and `primary_color` are `#RRGGBB` (uppercase); `NULL` means "use the default color".
export const restaurantAppearance = sqliteTable("restaurant_appearance", {
  restaurantId: text("restaurant_id")
    .primaryKey()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  description: text("description").notNull().default(""),
  bgColor: text("bg_color"),
  primaryColor: text("primary_color"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type AppearanceRow = typeof restaurantAppearance.$inferSelect;

/** A restaurant as the services see it: its own row merged with its appearance fields. */
export type RestaurantRow = typeof restaurants.$inferSelect &
  Pick<AppearanceRow, "logoUrl" | "coverUrl" | "description" | "bgColor" | "primaryColor">;
/** Input of `RestaurantsRepository.insert`: the appearance row is created with its defaults. */
export type NewRestaurantRow = typeof restaurants.$inferInsert;

// Store settings (1:1 with `restaurants`, created in the same batch as the restaurant).
export const restaurantSettings = sqliteTable("restaurant_settings", {
  restaurantId: text("restaurant_id")
    .primaryKey()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  acceptingOrders: integer("accepting_orders", { mode: "boolean" }).notNull().default(true),
  minOrderCents: integer("min_order_cents"),
  shippingCents: integer("shipping_cents").notNull().default(0),
  // With hours set and the store closed, take orders anyway (prepared when it opens) instead of
  // leaving the menu browse-only.
  acceptOrdersOutsideHours: integer("accept_orders_outside_hours", { mode: "boolean" }).notNull().default(false),
  // `flat` charges `shipping_cents` everywhere; `zones` prices by the `delivery_zones` rows.
  deliveryMode: text("delivery_mode").notNull().default("flat"),
  // The store's own location, the origin of radius and ring zones (`NULL` until the owner sets it).
  address: text("address"),
  addressNotes: text("address_notes"),
  lat: real("lat"),
  lng: real("lng"),
  placeId: text("place_id"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type StoreSettingsRow = typeof restaurantSettings.$inferSelect;
export type NewStoreSettingsRow = typeof restaurantSettings.$inferInsert;

// Store payment methods (N:1 with `restaurants`, composite PK `(restaurant_id, method)`).
export const restaurantPaymentMethods = sqliteTable(
  "restaurant_payment_methods",
  {
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    alias: text("alias"),
    holderName: text("holder_name"),
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.method] })],
);

export type PaymentMethodRow = typeof restaurantPaymentMethods.$inferSelect;
export type NewPaymentMethodRow = typeof restaurantPaymentMethods.$inferInsert;

// Menu categories. `position` is 0-based per restaurant; lists sort by position, then created_at.
// Names are unique per restaurant ignoring case. SQLite `lower()` only folds ASCII, so names that
// differ only in the case of an accented letter (e.g. "Ñoquis" / "ñoquis") are both accepted.
// `is_featured` marks the one category shown first in the public menu; a partial unique index
// keeps it to at most one per restaurant.
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    isFeatured: integer("is_featured", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("categories_restaurant_position_idx").on(t.restaurantId, t.position),
    uniqueIndex("categories_restaurant_name_unique").on(t.restaurantId, sql`lower(${t.name})`),
    uniqueIndex("categories_one_featured_per_restaurant")
      .on(t.restaurantId)
      .where(sql`${t.isFeatured} = 1`),
  ],
);

// Products. `price_cents` is an integer amount of ARS cents (no float rounding). `image_url` holds
// the public path of the single photo (the R2 key is derived from it). `available = false` means
// "Agotado". `position` is 0-based per category. A category with products cannot be deleted
// (`on delete restrict`, also checked by the service).
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    imageUrl: text("image_url"),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("products_restaurant_category_position_idx").on(t.restaurantId, t.categoryId, t.position)],
);

// Customizable ingredients of a product (Pro). `position` is the 0-based order inside the product.
// `extra_price_cents` is charged per unit above `included_qty`. The list is always replaced as a
// whole, so there is no per-ingredient uniqueness constraint (the service validates names).
// Deleting a product deletes its ingredients.
export const ingredients = sqliteTable(
  "ingredients",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    includedQty: integer("included_qty").notNull(),
    minQty: integer("min_qty").notNull(),
    maxQty: integer("max_qty").notNull(),
    extraPriceCents: integer("extra_price_cents").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("ingredients_product_position_idx").on(t.productId, t.position)],
);

// Customers table (find or create on first order by restaurant_id + phone).
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    address: text("address"),
    notes: text("notes"),
    firstOrderAt: integer("first_order_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("customers_restaurant_phone_unique").on(t.restaurantId, t.phone)],
);

// Addresses a customer used before (N:1 with `customers`), geocoded so they can be offered again.
export const customerAddresses = sqliteTable(
  "customer_addresses",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    // `home` | `work` | `other`; `NULL` when the customer did not label it.
    label: text("label"),
    formattedAddress: text("formatted_address").notNull(),
    locality: text("locality"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    placeId: text("place_id"),
    betweenStreets: text("between_streets"),
    unit: text("unit"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

// Delivery zones of a store (used when `restaurant_settings.delivery_mode` is `zones`). The first
// active zone by `sort` that contains the address wins. Shape and pricing columns are filled
// according to `shape` and `pricing`; the shared zod schema validates the combination.
export const deliveryZones = sqliteTable(
  "delivery_zones",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // `#RRGGBB` (uppercase), how the zone is drawn on the map.
    color: text("color").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sort: integer("sort").notNull(),
    // `radius` | `ring` | `polygon`.
    shape: text("shape").notNull(),
    radiusM: integer("radius_m"),
    innerRadiusM: integer("inner_radius_m"),
    // JSON `[[lat, lng], ...]` when `shape` is `polygon`.
    polygon: text("polygon"),
    // `fixed` | `per_km`.
    pricing: text("pricing").notNull(),
    priceCents: integer("price_cents"),
    baseCents: integer("base_cents"),
    perKmCents: integer("per_km_cents"),
    minShippingCents: integer("min_shipping_cents"),
    maxShippingCents: integer("max_shipping_cents"),
    minOrderCents: integer("min_order_cents"),
    freeFromCents: integer("free_from_cents"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("delivery_zones_restaurant_sort_idx").on(t.restaurantId, t.sort)],
);

// Opening hours of a store: one row per slot of a weekday (0 = Sunday), in minutes since midnight
// (Argentina time). `closes_at <= opens_at` crosses midnight (19:00–01:00). A weekday without rows is
// closed. `sort` is the slot's position within its day.
export const restaurantHours = sqliteTable(
  "restaurant_hours",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    opensAt: integer("opens_at").notNull(),
    closesAt: integer("closes_at").notNull(),
    // `all` | `delivery` | `takeaway`.
    fulfillment: text("fulfillment").notNull(),
    sort: integer("sort").notNull(),
  },
  (t) => [index("restaurant_hours_restaurant_weekday_sort_idx").on(t.restaurantId, t.weekday, t.sort)],
);

// Promo codes table (placeholder created empty for foreign key integrity in orders).
export const promoCodes = sqliteTable(
  "promo_codes",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: text("kind").notNull(),
    value: integer("value").notNull(),
    minOrderCents: integer("min_order_cents"),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("promo_codes_restaurant_code_unique").on(t.restaurantId, sql`lower(${t.code})`)],
);

// Orders table. Correlative number per restaurant, idempotent client_token.
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    number: integer("number").notNull(),
    clientToken: text("client_token").notNull(),
    status: text("status").notNull().default("new"),
    paymentStatus: text("payment_status").notNull().default("pending"),
    fulfillment: text("fulfillment").notNull(),
    paymentMethod: text("payment_method").notNull(),
    // `web` for orders placed from the public menu; `local` or `whatsapp` for the ones loaded by hand.
    source: text("source").notNull().default("web"),
    // Cash part of a `split` order and "¿Con cuánto abonás?"; both `NULL` unless they apply.
    splitCashCents: integer("split_cash_cents"),
    cashTenderedCents: integer("cash_tendered_cents"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    deliveryAddress: text("delivery_address"),
    // Snapshot of the geocoded delivery address and the zone that priced it (all `NULL` for
    // takeaway, flat-rate stores and orders placed before delivery zones).
    deliveryLat: real("delivery_lat"),
    deliveryLng: real("delivery_lng"),
    deliveryPlaceId: text("delivery_place_id"),
    deliveryUnit: text("delivery_unit"),
    deliveryBetweenStreets: text("delivery_between_streets"),
    // Diner's tag for the address: `home`, `work` or `other`.
    deliveryLabel: text("delivery_label"),
    deliveryZoneId: text("delivery_zone_id").references(() => deliveryZones.id, { onDelete: "set null" }),
    deliveryZoneName: text("delivery_zone_name"),
    deliveryDistanceM: integer("delivery_distance_m"),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    // Courier tip, kept apart from the products subtotal and the shipping.
    tipCents: integer("tip_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    promoCodeId: text("promo_code_id").references(() => promoCodes.id, { onDelete: "set null" }),
    // Courier who took the order (set when it goes from ready to sent). `NO ACTION` for the same
    // reason as `restaurant_members.role_id`; deleting a member with orders is blocked by the service.
    courierMemberId: text("courier_member_id").references(() => restaurantMembers.id, { onDelete: "no action" }),
    // Exact time the order went out and was delivered; both `NULL` for orders older than 0012.
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    // Exact time it was marked paid (cash drawer change 14b). `NULL` for orders older than 0014.
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    // Cash session it entered; `NULL` when it was paid without an open cash.
    cashSessionId: text("cash_session_id").references(() => cashSessions.id, { onDelete: "set null" }),
    // When and by whom "Ingresar a la caja" was used (delivery cash and split orders).
    settledAt: integer("settled_at", { mode: "timestamp_ms" }),
    settledByMemberId: text("settled_by_member_id").references(() => restaurantMembers.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("orders_restaurant_number_unique").on(t.restaurantId, t.number),
    uniqueIndex("orders_restaurant_token_unique").on(t.restaurantId, t.clientToken),
    index("orders_restaurant_status_number_idx").on(t.restaurantId, t.status, t.number),
    index("orders_restaurant_created_idx").on(t.restaurantId, t.createdAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_restaurant_courier_status_idx").on(t.restaurantId, t.courierMemberId, t.status),
    index("orders_restaurant_delivered_idx").on(t.restaurantId, t.deliveredAt),
    index("orders_restaurant_cash_session_idx").on(t.restaurantId, t.cashSessionId),
    index("orders_restaurant_settled_idx").on(t.restaurantId, t.settledAt),
  ],
);

// Order line items snapshot.
export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    optionsJson: text("options_json"),
    notes: text("notes"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// Messages the store keeps for each order status change, one per fulfillment and destination status.
// `fulfillment = takeaway` never has a `sent` row (a takeaway order is not sent).
export const orderMessageTemplates = sqliteTable(
  "order_message_templates",
  {
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    fulfillment: text("fulfillment").notNull(),
    targetStatus: text("target_status").notNull(),
    body: text("body").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.fulfillment, t.targetStatus] })],
);

export type OrderMessageTemplateRow = typeof orderMessageTemplates.$inferSelect;

// Fixed-window request counters of the public endpoints that cost money (address search). One row
// per key (e.g. `places:<slug>:<ip>`); `window_start` is the epoch ms the current window began.
// Rows of past windows are deleted as new requests arrive.
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [index("rate_limits_window_start_idx").on(t.windowStart)],
);

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type IngredientRow = typeof ingredients.$inferSelect;
export type NewIngredientRow = typeof ingredients.$inferInsert;
export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;
export type CustomerAddressRow = typeof customerAddresses.$inferSelect;
export type NewCustomerAddressRow = typeof customerAddresses.$inferInsert;
export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;
export type NewDeliveryZoneRow = typeof deliveryZones.$inferInsert;
export type PromoCodeRow = typeof promoCodes.$inferSelect;
export type OrderDbRow = typeof orders.$inferSelect;
export type NewOrderDbRow = typeof orders.$inferInsert;
export type OrderItemDbRow = typeof orderItems.$inferSelect;
export type NewOrderItemDbRow = typeof orderItems.$inferInsert;

// Roles of a restaurant. The system role ("Dueño", `is_system = 1`) is created with the restaurant,
// belongs to its owner and grants everything without rows in `role_permissions`. Names are unique
// per restaurant ignoring case (ASCII only, as `lower()` in SQLite); the schema layer also rejects
// the reserved owner name in any casing.
export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("roles_restaurant_name_unique").on(t.restaurantId, sql`lower(${t.name})`)],
);

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;

// One row per permission key a role grants (the catalog lives in `@menucito/shared`, so a key that
// is no longer in the catalog is ignored when read). No rows for the system role.
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

// People with access to a restaurant, the owner included (`is_owner = 1`, kept in sync with
// `restaurants.owner_id`, which stays the source of truth). One membership per user (`UNIQUE(user_id)`).
// A role cannot be deleted while a member uses it. The FK is `NO ACTION` (checked when the statement ends),
// not `RESTRICT` (checked per row): deleting a restaurant or an owner cascades to both its roles and its
// members, and `RESTRICT` would fail depending on which table the cascade reaches first.
export const restaurantMembers = sqliteTable(
  "restaurant_members",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "no action" }),
    firstName: text("first_name").notNull(),
    // Empty only for owners backfilled from a single-word account name.
    lastName: text("last_name").notNull(),
    // E.164 (`+5491112345678`).
    phone: text("phone"),
    isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
    isCourier: integer("is_courier", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("restaurant_members_restaurant_active_idx").on(t.restaurantId, t.active)],
);

export type MemberRow = typeof restaurantMembers.$inferSelect;
export type NewMemberRow = typeof restaurantMembers.$inferInsert;

// One cash session per restaurant at a time (partial unique index), no separate "cash drawers" table.
// The names of who opened and closed are copied so the history reads after a member is deleted.
export const cashSessions = sqliteTable(
  "cash_sessions",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    openingCashCents: integer("opening_cash_cents").notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    countedCashCents: integer("counted_cash_cents"),
    expectedCashCents: integer("expected_cash_cents"),
    differenceCents: integer("difference_cents"),
    closeNote: text("close_note"),
    openedByMemberId: text("opened_by_member_id").references(() => restaurantMembers.id, { onDelete: "set null" }),
    openedByName: text("opened_by_name").notNull(),
    closedByMemberId: text("closed_by_member_id").references(() => restaurantMembers.id, { onDelete: "set null" }),
    closedByName: text("closed_by_name"),
  },
  (t) => [
    uniqueIndex("cash_sessions_one_open_per_restaurant")
      .on(t.restaurantId)
      .where(sql`${t.closedAt} is null`),
    index("cash_sessions_restaurant_opened_idx").on(t.restaurantId, t.openedAt),
  ],
);

export type CashSessionRow = typeof cashSessions.$inferSelect;
export type NewCashSessionRow = typeof cashSessions.$inferInsert;

// Every movement of a cash session. A "Dividir pago" movement is two rows sharing `group_id`
// (`cash` + `transfer`); automatic split incomes are `order_split_income` rows tied to their order.
export const cashMovements = sqliteTable(
  "cash_movements",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => cashSessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    comment: text("comment"),
    groupId: text("group_id").notNull(),
    orderId: text("order_id").references(() => orders.id, { onDelete: "set null" }),
    courierMemberId: text("courier_member_id").references(() => restaurantMembers.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByMemberId: text("created_by_member_id").references(() => restaurantMembers.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    editedByName: text("edited_by_name"),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    voidedByName: text("voided_by_name"),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("cash_movements_session_created_idx").on(t.sessionId, t.createdAt),
    index("cash_movements_group_idx").on(t.groupId),
    index("cash_movements_order_idx").on(t.orderId),
  ],
);

export type CashMovementRow = typeof cashMovements.$inferSelect;
export type NewCashMovementRow = typeof cashMovements.$inferInsert;

// Close snapshot of one method: written once, in the same batch as `closed_at`, and never recomputed.
export const cashSessionTotals = sqliteTable(
  "cash_session_totals",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => cashSessions.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    salesCount: integer("sales_count").notNull(),
    salesCents: integer("sales_cents").notNull(),
    incomeCount: integer("income_count").notNull(),
    incomeCents: integer("income_cents").notNull(),
    expenseCount: integer("expense_count").notNull(),
    expenseCents: integer("expense_cents").notNull(),
    tipCount: integer("tip_count").notNull(),
    tipCents: integer("tip_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.method] })],
);

export type CashSessionTotalsRow = typeof cashSessionTotals.$inferSelect;
