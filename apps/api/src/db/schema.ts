import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
// `logo_url` holds the public path of the logo (the R2 key is derived from it).
// `colors` and `hours_json` come in later changes.
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
  logoUrl: text("logo_url"),
  plan: text("plan").notNull().default("basic"),
  status: text("status").notNull().default("trial"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type RestaurantRow = typeof restaurants.$inferSelect;
export type NewRestaurantRow = typeof restaurants.$inferInsert;

// Menu categories. `position` is 0-based per restaurant; lists sort by position, then created_at.
// Names are unique per restaurant ignoring case. SQLite `lower()` only folds ASCII, so names that
// differ only in the case of an accented letter (e.g. "Ñoquis" / "ñoquis") are both accepted.
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("categories_restaurant_position_idx").on(t.restaurantId, t.position),
    uniqueIndex("categories_restaurant_name_unique").on(t.restaurantId, sql`lower(${t.name})`),
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

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type IngredientRow = typeof ingredients.$inferSelect;
export type NewIngredientRow = typeof ingredients.$inferInsert;
