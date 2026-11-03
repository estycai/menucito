import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    deliveryAddress: text("delivery_address"),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    promoCodeId: text("promo_code_id").references(() => promoCodes.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("orders_restaurant_number_unique").on(t.restaurantId, t.number),
    uniqueIndex("orders_restaurant_token_unique").on(t.restaurantId, t.clientToken),
    index("orders_restaurant_status_number_idx").on(t.restaurantId, t.status, t.number),
    index("orders_restaurant_created_idx").on(t.restaurantId, t.createdAt),
    index("orders_customer_idx").on(t.customerId),
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

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type IngredientRow = typeof ingredients.$inferSelect;
export type NewIngredientRow = typeof ingredients.$inferInsert;
export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;
export type PromoCodeRow = typeof promoCodes.$inferSelect;
export type OrderDbRow = typeof orders.$inferSelect;
export type NewOrderDbRow = typeof orders.$inferInsert;
export type OrderItemDbRow = typeof orderItems.$inferSelect;
export type NewOrderItemDbRow = typeof orderItems.$inferInsert;
