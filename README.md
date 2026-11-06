# Menucito

Monorepo (pnpm + Turborepo):

- `apps/api` - Hono on Cloudflare Workers, Better Auth, Drizzle, D1 (SQLite), R2 (media), Zod.
- `apps/admin` - React + Vite + TypeScript, Tailwind, shadcn/ui-style components, TanStack Query, React Hook Form, react-router.
- `apps/web` - Astro (SSR on Cloudflare through `@astrojs/cloudflare`), the public site: placeholder landing at `/` the diner's menu at `/<slug>` and the order detail at `/<slug>/pedido`. Server-rendered HTML with small Preact islands (cart, ingredient sheet, order form).
- `packages/shared` - Zod schemas and pure helpers shared by both apps (auth forms, restaurant: slug rules, Argentine WhatsApp normalization, media limits, catalog schemas, ARS price parsing/formatting, plan limits).

Docs and specs: `docs/changes/` (current change: `14a-medios-de-pago-y-pago-dividido.md`). `Menucito/` is the Obsidian vault.

## Requirements

- Node.js 22+
- pnpm 12 (`npm i -g pnpm`)

## Setup

```bash
pnpm install

# API secrets (local). .dev.vars is gitignored.
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Fill BETTER_AUTH_SECRET:  openssl rand -base64 32
# BETTER_AUTH_URL must be http://localhost:5173 (the browser origin, see "How local dev works").
# EMAIL_FROM=onboarding@resend.dev

# Create the local D1 tables (stored in apps/api/.wrangler, no Cloudflare account needed)
pnpm --filter @menucito/api db:migrate:local
```

## Run

Three terminals:

```bash
pnpm --filter @menucito/api dev      # API on http://localhost:8787 (wrangler dev --local)
pnpm --filter @menucito/admin dev    # Admin on http://localhost:5173
pnpm --filter @menucito/web dev      # Public site on http://localhost:4321
```

Open http://localhost:5173 for the panel and http://localhost:4321/<slug> for a restaurant's public menu (the web app needs the API running; `/` does not).

To make the "Tu link" of the admin's "Resumen" point to the local web app, start the admin with `VITE_PUBLIC_BASE=localhost:4321` (for example in `apps/admin/.env.local`, which is gitignored). The link uses `http://` for `localhost` and `127.0.0.1`, `https://` otherwise.

Node.js note: Astro 7.4 and later require Node 22.22+, so `apps/web` pins Astro `~7.3.8` and `@astrojs/cloudflare` `~14.3.4`, which work on Node 22.12+. Raise both when the team moves to a newer Node 22.

### How local dev works

The admin Vite server proxies `/api` to `http://localhost:8787`, so the browser only talks to `http://localhost:5173`. Cookies are first-party and `BETTER_AUTH_URL` is `http://localhost:5173`. Google's redirect URI is therefore `http://localhost:5173/api/auth/callback/google`.

### Emails without Resend

If `RESEND_API_KEY` is empty, emails are NOT sent. They are logged in the API terminal, for example:

```
[email:dev] {"to":"you@example.com","subject":"Confirmá tu email","link":"http://localhost:5173/api/auth/verify-email?token=..."}
```

Copy the `link` into your browser to verify the email or reset the password.

### Google button without credentials

If `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are empty, the Google provider is not registered and the button shows an error. Email/password works regardless.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test      # Vitest: shared helpers, admin and web helpers, and the API in the Workers runtime (in-memory D1 and R2)
# or everything: pnpm turbo lint typecheck test build
```

## API

Own endpoints follow a layered architecture in `apps/api/src`: `routes/` (Hono, Zod validation, JSON) -> `services/` (business rules, domain errors) -> `repositories/` (Drizzle/D1), plus `storage/` (R2, used only by services) and `middleware/require-session.ts`. The tenant (owner) always comes from the session, never from the request body. Errors use the body `{"error": {"code", "message"}}`.

| Method and path | Response |
| --- | --- |
| `GET /api/restaurants/me` | 200 restaurant plus `access: {memberId, isOwner, isCourier, active, role: {id, name, active}, permissions}` (normalized keys; every key of the catalog for the owner; `[]` for a deactivated member or an inactive role, which still get a 200 so the admin can show the right screen), 404 `RESTAURANT_NOT_FOUND` if the user has no restaurant and is not a member of one |
| `GET /api/restaurants/slug-available?slug=` | 200 `{available, reason?: "invalid" | "reserved" | "taken"}` |
| `POST /api/restaurants` | body `{name, slug, whatsapp, delivery, takeaway}`; 201 restaurant, 409 `SLUG_TAKEN` / `ALREADY_HAS_RESTAURANT`, 422 `VALIDATION_ERROR` |
| `PUT /api/restaurants/me/logo` | multipart/form-data, field `file` (WebP, max 1 MB); 200 `{logoUrl}`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 404 `RESTAURANT_NOT_FOUND` |
| `DELETE /api/restaurants/me/logo` | 204 (also when there is no logo) |
| `PATCH /api/restaurants/me/appearance` | body with at least one of `{description?, bgColor?, primaryColor?}` (colors are `#RGB`/`#RRGGBB`, with or without `#`, stored as `#RRGGBB` uppercase; `null` goes back to the default). `description` is whitespace-normalized, max 120 characters, empty is valid. 200 restaurant, 403 `PLAN_FEATURE` if the body has any color key (even `null`) and the plan lacks `customColors`, 404 `RESTAURANT_NOT_FOUND`, 422 `VALIDATION_ERROR` (bad format, empty body, or the resulting pair gives the primary color less than 3:1 contrast against the background) |
| `GET /api/restaurants/me/settings` | 200 store settings: `{acceptingOrders, acceptOrdersOutsideHours, minOrderCents, shippingCents, paymentMethods: [{method: "cash" \| "transfer" \| "split", enabled, alias, holderName}]}` |
| `PATCH /api/restaurants/me/settings` | body with subset of store settings; 200 settings (plus `splitDisabled: true` when disabling cash or transfer turned split off), 404, 422 `VALIDATION_ERROR` (at least one of cash/transfer, split only with both, and if `transfer` stays enabled its alias and holder are required) |
| `POST /api/public/menus/:slug/orders` | Public, CORS enabled for `WEB_ORIGINS`. Body `{clientOrderId, customer: {name, phone, address?}, fulfillment, paymentMethod: "cash" \| "transfer" \| "split", splitCashCents?, cashTenderedCents?, expectedTotalCents, tipCents?, items: [{productId, quantity, choices?}]}`. Recalculates total from DB (products + shipping + tip), creates or deduplicates customer by `phone`, throttles customer to 3 active orders, sequential `#number`, idempotent via `clientOrderId`. `tipCents` is an integer, a multiple of 100 (whole pesos), between 0 and $50.000, and only allowed on a `delivery` order paid by `transfer` or `split`. `split` needs `0 < splitCashCents < total` and a store with cash and transfer enabled (422 `VALIDATION_ERROR` otherwise); `cashTenderedCents` is optional, at most $10.000.000 and not below the cash part. 201 `{order, whatsappUrl, payment}`, 409 `STORE_PAUSED` / `PRICE_CHANGED` / `PRODUCT_UNAVAILABLE`, 429 `ORDER_THROTTLED`. Rate limit 10/min per IP |
| `GET /api/orders` | Owner orders listing. Query params: `status`, `fulfillment`, `paymentMethod` (`cash`, `transfer` or `split`), `paymentStatus`, `cashSessionId`, `settled` (`true`/`false`), `from`, `to`, `dateField` (`created`, the default, `updated`, or `delivered`: the timestamp `from`/`to` filter on), `limit`, `before`. Dates in `America/Argentina/Buenos_Aires`. 200 `{orders: OrderSummary[], nextBefore: string \| null}`; each order carries `source` (`web`, `local` or `whatsapp`), `notes`, `splitCashCents`, `cashTenderedCents`, `paymentBreakdown`, `paidAt`, `cashSessionId`, `settledAt` and its `courier` (`{memberId, firstName, lastName} \| null`) |
| `POST /api/orders` | `orders.create`. Body `{items, customer: {name, phone?, address?}, fulfillment, paymentMethod, splitCashCents?, cashTenderedCents?, source: "local" \| "whatsapp", notes?, markPaid?, clientOrderId, expectedTotalCents, tipCents?, delivery?}`: an employee loads a counter or WhatsApp order. Phone is optional for `local` (stored as `''`) and required for `whatsapp`. Skips pause, opening hours and the phone throttle; keeps fulfillment, payment method, prices, shipping, minimum, split and tip rules. `markPaid` marks it paid after inserting (it enters the open cash with the same rules as `PATCH /api/orders/:id/payment`); if that fails, 201 with `paymentError` and the order stays pending. 201 `OrderDetail`, 200 with the stored order when `clientOrderId` repeats, 409 `PRICE_CHANGED` / `PRODUCT_UNAVAILABLE` / `FULFILLMENT_NOT_OFFERED` / `PAYMENT_METHOD_NOT_ACCEPTED` / `BELOW_MINIMUM`, 422 `OUT_OF_COVERAGE` / `VALIDATION_ERROR` |
| `GET /api/orders/:id` | Owner order detail with items snapshot, ingredient choices, customer information, `source`, `notes`, `courier`, `sentAt`, `deliveredAt`, `paidAt`, `cashSessionId`, `settledAt`, `tipCents`, `splitCashCents`, `cashTenderedCents` and `paymentBreakdown`; 200 `OrderDetail`, 404 `ORDER_NOT_FOUND` |
| `GET /api/orders/places/search?q=&session=` | `orders.create`. Address suggestions for the "Nuevo pedido" popup (Google Places, biased to the store); 503 `MAPS_UNAVAILABLE` |
| `GET /api/orders/places/:placeId?session=` | `orders.create`. The chosen address with its coordinates; 404 `PLACE_NOT_FOUND`, 503 `MAPS_UNAVAILABLE` |
| `POST /api/orders/delivery-quote` | `orders.create`. Body `{lat, lng, subtotalCents}`: the same shipping quote as the public menu, with the session's store. 200 `{covered, shippingCents, minOrderCents}`; 409 `DELIVERY_ZONES_DISABLED` when the store uses a flat price |
| `GET /api/order-messages` | `orders.settings`. 200 `{templates: [{fulfillment: "delivery" \| "takeaway", targetStatus, body}]}` with the messages kept for each status change |
| `PUT /api/order-messages` | `orders.settings`. Body `{templates}`: replaces all messages of the local in one batch. Blank bodies are dropped and `takeaway` + `sent` is rejected. 200 like the GET, 422 on repeated pairs, more than 9 rows or a body over 1000 characters |
| `PATCH /api/orders/:id/status` | Transitions order status forward, skipping steps allowed: `new` -> `preparing` -> `ready` -> `sent` -> `delivered` for delivery orders, the same without `sent` for takeaway ones (sending a takeaway order is 409 `INVALID_TRANSITION`; `sent` also needs an assigned courier, 409 `COURIER_REQUIRED`). `cancelled` from any active status (`new`, `preparing`, `ready`, `sent`); `delivered` and `cancelled` are final. Delivering stamps `delivered_at` and, for a cash or split order, marks it `paid` with `paid_at` in the same write; a delivery cash order stays out of the cash until "Ingresar a la caja". Cancelling while its cash is open removes it from the open totals and deletes its automatic split incomes. Body `{status, expectedStatus}` (optimistic lock); 200 `OrderDetail`, 409 `CONCURRENT_MODIFICATION`, 422 |
| `POST /api/orders/:id/assign` | `orders.assign`. Body `{courierMemberId}`: an active courier of the local. A `ready` delivery order becomes `sent` with `sent_at`; a `sent` order changes courier keeping `sent_at`. 200 `OrderDetail`, 404 `ORDER_NOT_FOUND`, 409 `CONCURRENT_MODIFICATION`, 422 (not a courier of this local, inactive, takeaway or wrong status) |
| `PATCH /api/orders/:id/payment` | Updates payment status (`pending` \| `paid`). Marking paid enters the open cash when the money lands there: any transfer, and cash or split takeaway. Delivery cash and split orders stay to settle until "Ingresar a la caja". Without an open cash the order is still paid and says "Cobrado sin caja abierta". Returning a paid order to pending is 409 `ORDER_SETTLED` when it entered a cash (undo the settlement first) and 409 `CASH_SESSION_CLOSED` when its cash is closed. Body `{paymentStatus}`; 200 `OrderDetail`, 422 |
| `PATCH /api/orders/:id/payment-method` | `orders.payment`. Body `{paymentMethod, splitCashCents?, cashTenderedCents?, expectedStatus}`. Changes the method, the cash part and the tendered amount while the order is not paid, delivered, cancelled nor entered in a cash drawer. In a split the cash part stays below `total - tip` (the tip always goes by transfer). Moving to `cash` drops the tip and recalculates the total. 200 `OrderDetail`, 404 `ORDER_NOT_FOUND`, 409 `PAYMENT_LOCKED` (paid or in a drawer), 409 `CONCURRENT_MODIFICATION`, 409 `INVALID_TRANSITION` (delivered or cancelled), 422 |
| `GET /api/orders/export` | Exports orders matching filters as CSV, including the `Repartidor`, `Propina`, `Efectivo`, `Transferencia`, `Abona con`, `Vuelto`, `Origen` and `Comentario` columns. Includes UTF-8 BOM, semicolon delimiter, comma decimal separator, and Excel formula injection protection; 200 `text/csv` |
| `GET /api/cash-sessions/current` | `cash.view`. 200 `{session, totals, movements, openingSuggestionCents, chargedWithoutCashToday, toSettle, courierAccounts, onTheStreet, storeClosed, lastClosed}`. Without `cash.expected` the expected and the cash totals come as `null` (blind close); sales and movements are still visible. `session` is `null` when no cash is open; `openingSuggestionCents` is the previous closing count. Delivery cash and split orders appear in `toSettle` grouped by courier, with the change they carry |
| `POST /api/cash-sessions` | `cash.open`. Body `{openingCashCents}`; 201 session. 409 `CASH_SESSION_ALREADY_OPEN` (partial unique index per restaurant), 403 `PLAN_FEATURE` without `cashRegister`, 422 |
| `POST /api/cash-sessions/current/movements` | `cash.movements`. Body `{kind: "income" \| "expense" \| "courier_payment", method: "cash" \| "transfer" \| "split", amountCents?, cashCents?, transferCents?, courierMemberId?, comment?}`. A split is two rows (cash + transfer) shown as one; a courier payment needs an active courier and cannot be split. 201, 409 `NO_OPEN_CASH_SESSION`, 422 |
| `PATCH /api/cash-sessions/current/movements/:id` | `cash.movements`. Same amount fields as creation. 200, 409 `NO_OPEN_CASH_SESSION` / `CASH_SESSION_CLOSED` / `MOVEMENT_LOCKED` (automatic split incomes and change rows are not editable), 404 `CASH_MOVEMENT_NOT_FOUND`, 422 |
| `POST /api/cash-sessions/current/movements/:id/void` | `cash.movements`. Marks the movement voided (it stays in the history); 200, 409 `NO_OPEN_CASH_SESSION` / `CASH_SESSION_CLOSED` / `MOVEMENT_LOCKED`, 404 |
| `POST /api/cash-sessions/current/settlements` | `cash.settle`. Body `{orderIds: string[], changeBackCents?}`. Enters delivered cash or split orders; a split creates one `order_split_income` per part ("Ingreso Pedido #N - Efectivo/Transferencia"), never a sale. 201, 409 `NO_OPEN_CASH_SESSION`, 422 for a foreign, not delivered or already settled order |
| `DELETE /api/cash-sessions/current/settlements/:orderId` | `cash.settle`. Undoes the settlement and deletes its automatic split incomes while the cash is open. 204, 409 `NO_OPEN_CASH_SESSION` / `CASH_SESSION_CLOSED`, 422 |
| `POST /api/cash-sessions/current/courier-change` | `cash.settle`. Body `{courierMemberId, amountCents}`: cash leaving the drawer with the courier; 201, 409 `NO_OPEN_CASH_SESSION`, 422 |
| `POST /api/cash-sessions/current/close` | `cash.close`. Body `{countedCashCents, note?}`; `0` is valid. Writes `closed_at`, the difference and the per-method `cash_session_totals` snapshot in one D1 batch. 200 `{detail, pending}`, 409 `NO_OPEN_CASH_SESSION`. Without `cash.expected` the close is blind: the expected arrives in this response |
| `GET /api/cash-sessions` | `cash.history`. Query `page` (1+) and `limit` (1-50, 20 by default). 200 `{sessions, page, limit, total}` of closed sessions, newest first |
| `GET /api/cash-sessions/:id` | `cash.history`. 200 `CashSessionDetail` from the close snapshot (`totals`, `movements`, `courierIncomes`, `courierPayments`, `tipsCents`, `onTheStreet`), 404 `CASH_SESSION_NOT_FOUND` |
| `GET /api/couriers` | `orders.assign`. 200 `{memberId, firstName, lastName}[]` of the active couriers of the local, by name, each with `inProgressOrders` (orders currently `sent`) |
| `GET /api/couriers/summary` | `couriers.view`. Query `from`, `to` (local days, both inclusive; today by default), `status` (`delivered` by default, `sent` or `all`: delivered orders count by `delivered_at`, orders on the way by `sent_at`) and optional `courierMemberId`. 200 `{from, to, couriers: [{memberId, firstName, lastName, active}], rows: [{memberId, firstName, lastName, active, delivered, inProgress, shippingCents, tipCents}], totals}`; `couriers` lists every courier of the local (active or not) for the page's filter, so its options survive a range with no deliveries; a `memberId: null` row is "Sin repartidor", `active: false` marks a deactivated courier, and filtering by a courier with no deliveries returns his zero row. 422 for an unknown or foreign `courierMemberId` or another `status` |
| `GET /api/deliveries` | `requireCourier`. The courier's own `sent` orders, oldest first, with the data needed to deliver them (`customerName`, `customerPhone`, `deliveryAddress`, `deliveryLocation`, `notes`, `paymentMethod`, `splitCashCents`, `cashTenderedCents`, `paymentBreakdown`, `totalCents`, `shippingCents`, `tipCents`, `sentAt`). A stranger's order is never listed |
| `GET /api/deliveries/summary` | `requireCourier`. Query `from`, `to` (today by default). 200 `{from, to, delivered, shippingCents, tipCents}` of the courier's own delivered orders |
| `POST /api/deliveries/:id/delivered` | `requireCourier`. Marks one of the courier's own `sent` orders as `delivered` (stamping `delivered_at` and, for cash or split, paying it). 200 order, 404 for an unknown or foreign order, 409 `INVALID_TRANSITION` if it is not `sent` |
| `PUT /api/restaurants/me/cover` | multipart/form-data, field `file` (WebP, max 1 MB); 200 `{coverUrl}`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 404 `RESTAURANT_NOT_FOUND`. No plan check |
| `DELETE /api/restaurants/me/cover` | 204 (also when there is no cover) |
| `PUT /api/restaurants/me/plan` | body `{plan: "basic" \| "pro"}`; 200 restaurant (the current plan is a no-op), 403 `PLAN_SWITCH_DISABLED` unless `ALLOW_PLAN_SWITCH=true`, 404 `RESTAURANT_NOT_FOUND`, 422 `VALIDATION_ERROR`. Free test switch, see "Plan switch" |
| `GET /api/media/*` | Public, no session. Serves `logos/...`, `products/...` and `covers/...` keys only. 200 `image/webp` with `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`; 404 `NOT_FOUND` |
| `GET /api/public/menus/:slug` | Public, no session. 200 `{restaurant: {name, slug, logoUrl, delivery, takeaway, coverUrl, description, colors: {background, primary}}, featured: {name, products} | null, categories: [{name, products: [{id, name, description, priceCents, imageUrl, available, ingredients}]}]}`; categories without products are left out. `featured` is the one featured category (`null` if there is none or it has no products) and it is never repeated in `categories`. `colors` are the saved ones only on a plan with `customColors` (Pro), the Menucito defaults otherwise, even if colors were saved before a downgrade. The only ids are the opaque product ids (the cart key); no owner, plan, status, WhatsApp or timestamps. `ingredients` (`{name, includedQty, minQty, maxQty, extraPriceCents}`) is empty unless the restaurant's plan has customizable ingredients, even if some were saved before a downgrade. Works for any plan and status. `Cache-Control: public, max-age=60` (the web pages `/<slug>` and `/<slug>/pedido` fetch it with `cache: "no-store"` and answer `Cache-Control: private, no-cache`, so pausing or resuming orders shows on the next load). 404 `RESTAURANT_NOT_FOUND` for an unknown, malformed or reserved slug |
| `GET /api/categories` | 200 `{categories: [{id, name, position, featured, products: [Product]}], usage: {products, maxProducts, productPhotos}}` (both lists ordered by `position`) |
| `POST /api/categories` | body `{name}` (trimmed, 1-40); 201 category, 409 `CATEGORY_NAME_TAKEN` (case-insensitive), 422 |
| `PATCH /api/categories/:id` | body `{name}`; 200 category, 404 `CATEGORY_NOT_FOUND`, 409 `CATEGORY_NAME_TAKEN`, 422 |
| `DELETE /api/categories/:id` | 204, 404, 409 `CATEGORY_NOT_EMPTY` (a category with products is never deleted) |
| `PUT /api/categories/order` | body `{ids}` with every category id exactly once; 204, 422 otherwise |
| `PUT /api/categories/:id/featured` | body `{featured: boolean}`; 204, 404 `CATEGORY_NOT_FOUND`, 422. `true` makes it the restaurant's only featured category (the previous one is unmarked in the same D1 batch, a partial unique index backs it); `false` unmarks it only if it was the featured one. No plan check |
| `PUT /api/categories/:id/products/order` | body `{ids}` with every product id of the category exactly once; 204, 404, 422 |
| `POST /api/products` | body `{categoryId, name, description?, priceCents, available?}`; 201 product, 403 `PLAN_LIMIT`, 404 `CATEGORY_NOT_FOUND`, 422 |
| `GET /api/products/:id` | 200 product, 404 `PRODUCT_NOT_FOUND` |
| `PATCH /api/products/:id` | any subset of the create fields; a new `categoryId` moves it to the end of that category; 200, 404, 422 |
| `DELETE /api/products/:id` | 204 (also deletes its photo), 404 |
| `PUT /api/products/:id/ingredients` | body `{ingredients: [{name, includedQty, minQty, maxQty, extraPriceCents}]}` (the whole ordered list; it replaces the saved one in one batch, `[]` clears it); 200 `{ingredients}`, 403 `PLAN_FEATURE` (plan without `customIngredients`), 404 `PRODUCT_NOT_FOUND`, 422 `VALIDATION_ERROR` |
| `PUT /api/products/:id/photo` | multipart/form-data, field `file` (WebP, max 1 MB); 200 `{imageUrl}`, 403 `PLAN_LIMIT`, 404, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` |
| `DELETE /api/products/:id/photo` | 204 (also when there is no photo), 404 |
| `GET /api/members` | Owner only. Query `page`, `limit` (default 20), `courier=true`, `active=true`. 200 `{members: Member[], page, limit, total}`: first name, last name, email, phone (E.164), role, `isCourier`, `isOwner`, `active`; the owner first, then by name |
| `POST /api/members` | Owner only. Body `{firstName, lastName, email, password (8-128), roleId, phone?, isCourier?}`. Creates the account with a verified email and a credential password; no email is sent. 201 member (never the password), 409 `EMAIL_IN_USE` (the email exists in any account), 422 `VALIDATION_ERROR` (also a `roleId` of another restaurant, inactive, or the system role) |
| `PATCH /api/members/:id` | Owner only. Body with any of `{firstName, lastName, phone, roleId, isCourier}`; an `email` or `password` key is rejected. 200 member, 404 `MEMBER_NOT_FOUND`, 409 `OWNER_IMMUTABLE` (changing the owner's role), 422 |
| `PATCH /api/members/:id/active` | Owner only. Body `{active}`. Deactivating deletes the member's sessions. 200 member, 404, 409 `OWNER_IMMUTABLE` |
| `PUT /api/members/:id/password` | Owner only. Body `{password}`. Replaces the credential and deletes every session of that user. 204, 404, 409 `OWNER_IMMUTABLE`, 422 |
| `DELETE /api/members/:id` | Owner only. Deletes the member and the account (sessions and credentials with it); the email can be reused. 204, 404, 409 `OWNER_IMMUTABLE`, 409 `MEMBER_HAS_HISTORY` (the member has orders assigned, in any status: deactivate it instead) |
| `GET /api/roles` | Owner only. 200 `{roles: Role[]}` with `{id, name, isSystem, active, memberCount, permissions}`; the system role first (its `permissions` is `[]`: the owner check grants everything), then by name |
| `POST /api/roles` | Owner only. Body `{name (1-40), permissions}`; unknown keys are dropped, a sub-permission without its section key is rejected. 201 role, 409 `ROLE_NAME_TAKEN` (case-insensitive, per restaurant), 422 |
| `PATCH /api/roles/:id` | Owner only. Body with any of `{name, permissions, active}`; the permissions are replaced as a whole in one D1 batch and take effect on the member's next request. 200 role, 404 `ROLE_NOT_FOUND`, 409 `SYSTEM_ROLE` / `ROLE_NAME_TAKEN`, 422 |
| `DELETE /api/roles/:id` | Owner only. 204, 404, 409 `SYSTEM_ROLE`, 409 `ROLE_IN_USE` with `error.memberCount` |

Product: `{id, categoryId, name, description, priceCents, imageUrl, available, ingredients, position, createdAt, updatedAt}`. Prices are integer ARS cents (`900000` = `$9.000`); `available: false` means "Agotado". `ingredients` is the ordered list of customizable ingredients (`[]` when none), returned on every plan by `GET /api/categories` and `GET /api/products/:id`.

Ingredient: `{name, includedQty, minQty, maxQty, extraPriceCents}`. `extraPriceCents` is charged for each unit above `includedQty`. Rules (shared Zod schema, enforced by the API and the admin form): name 1-40 characters and unique inside the product ignoring case, quantities are integers 0-99, `maxQty >= 1`, `minQty <= includedQty <= maxQty`, extra price is zero or more, at most 20 per product. Ingredients are deleted with their product. This change only covers saving them in the admin; ordering them from the public menu and the price calculation come with the public menu.

All `/api/restaurants/*`, `/api/categories/*`, `/api/products/*`, `/api/orders/*`, `/api/cash-sessions/*`, `/api/couriers/*`, `/api/deliveries/*`, `/api/members/*` and `/api/roles/*` endpoints answer 401 `UNAUTHORIZED` without a session, and 404 `RESTAURANT_NOT_FOUND` when the user has no restaurant. Besides the codes listed per endpoint, any of them can answer the access errors of "Users and roles" below (the `/api/deliveries/*` ones answer 403 `NOT_A_COURIER` when the member is not marked as a courier). The tenant is the session's restaurant: an id that belongs to another restaurant answers 404, never 403. WhatsApp numbers are stored normalized as `549` + area code + number (digits only).

### Users and roles

A restaurant can have several people with access. Everyone is a member (`restaurant_members`, one restaurant per user); the owner (`restaurants.owner_id`) is a member too, with the system role "Dueño". The middleware `requireMember` (`apps/api/src/middleware/require-member.ts`) resolves the member, the restaurant and the effective permissions from the session on every request, so a role change shows up on the next request without signing in again. Each route of the owner's API declares one guard (`requirePermission(key)`, `requireOwner`, `allowAnyMember` or `requireCourier`; the last one needs `is_courier` and opens `/api/deliveries/*`); `test/route-guards.test.ts` fails when a registered route declares none.

Permissions are text keys `<section>.<action>`, defined in `packages/shared/src/permissions.ts` (adding one needs no migration; a stored key that left the catalog is ignored). Each section has a `.view` key and its sub-permissions only count with the section checked:

| Section | Keys |
| --- | --- |
| Resumen | `summary.view` |
| Pedidos | `orders.view`, `orders.status` (change status, cancel), `orders.payment` (mark paid or pending), `orders.export` (CSV), `orders.assign` (choose the courier), `orders.create` (load an order by hand), `orders.settings` (messages per status change) |
| Cajas | `cash.view`, `cash.open`, `cash.movements` (create, edit, void), `cash.close`, `cash.settle` (settle orders, give change), `cash.history` (history and printed arqueo), `cash.expected` (see the expected and the cash totals; without it the close is blind) |
| Repartidores | `couriers.view` (daily summary by courier; the page is `/repartidores`) |
| Mi menú | `menu.view`, `menu.edit` |
| Mi local | `store.view`, `store.edit` (data, appearance, hours, delivery, payments, pause; also the `/me/places/*` lookups) |
| Link y QR | `qr.view` (the QR card inside Resumen; no section of its own) |
| Reportes | `stats.view` |

Reads need the `.view` key and writes the sub-permission; `GET /api/restaurants/me/settings`, `/hours`, `/location` and `/delivery-zones` need `store.view`. "Usuarios" (`/api/members`, `/api/roles`) and "Plan y pagos" (`PUT /api/restaurants/me/plan`) are owner only: they are not permissions anyone can be given. "Mis repartos" (`/api/deliveries/*`, admin `/mis-repartos`) is not a permission either: it follows the `is_courier` mark, so the same member keeps its role's sections and gains the courier one.

New error codes (body `{"error": {"code", "message", ...}}`):

| Code | Status | When |
| --- | --- | --- |
| `FORBIDDEN` | 403 | The member lacks the permission; the body carries `error.permission` with the missing key |
| `MEMBER_INACTIVE` | 403 | The owner deactivated the user |
| `OWNER_ONLY` | 403 | A member who is not the owner called an owner-only route |
| `MEMBER_NOT_FOUND`, `ROLE_NOT_FOUND` | 404 | Unknown id, or one of another restaurant |
| `EMAIL_IN_USE` | 409 | The email already has an account (any restaurant, any sign-up method) |
| `OWNER_IMMUTABLE` | 409 | Role, active flag, password or deletion of the owner's member |
| `SYSTEM_ROLE` | 409 | Editing, deactivating or deleting the "Dueño" role |
| `ROLE_IN_USE` | 409 | Deleting a role with members; the body carries `error.memberCount` |
| `ROLE_NAME_TAKEN` | 409 | Another role of the restaurant has that name (case-insensitive) |
| `COURIER_REQUIRED` | 409 | Moving a delivery order to `sent` without an assigned courier |
| `PAYMENT_LOCKED` | 409 | Changing the payment method of a paid order (or one entered in a cash drawer) |
| `CASH_SESSION_ALREADY_OPEN` | 409 | Opening a cash when the restaurant already has one open |
| `NO_OPEN_CASH_SESSION` | 409 | Movements, settlements, change or close without an open cash ("Abrí la caja primero") |
| `CASH_SESSION_CLOSED` | 409 | Touching a movement, settlement or order of a cash that is already closed |
| `ORDER_SETTLED` | 409 | Returning an order to pending while it is entered in a cash; undo the settlement first |
| `MOVEMENT_LOCKED` | 409 | Editing or voiding an automatic split income, a change row or an already voided movement |
| `CASH_SESSION_NOT_FOUND`, `CASH_MOVEMENT_NOT_FOUND` | 404 | Unknown cash or movement id, or one of another restaurant |
| `NOT_A_COURIER` | 403 | A member without the `is_courier` mark called an `/api/deliveries/*` route |
| `MEMBER_HAS_HISTORY` | 409 | Deleting a member with orders assigned; deactivate it instead |

A user who is already a member also gets 409 `ALREADY_HAS_RESTAURANT` on `POST /api/restaurants`. Accounts created by the owner go through `apps/api/src/auth-admin.ts` (Better Auth's internal adapter): verified email, hashed password, no email sent. API error messages are in Spanish.

### Logo and media (R2)

- The restaurant logo is available on every plan (no plan check). The admin (`/local`, "Mi local") normalizes any PNG, JPG, WebP, GIF or SVG in the browser to a 512x512 WebP ("contain", transparent padding) and uploads only that WebP; SVGs are rasterized through an `<img>`, so their scripts never run and the SVG itself is never uploaded.
- The Worker validates size (<= 1 MB), `Content-Type: image/webp` and the `RIFF....WEBP` signature, writes `logos/<restaurantId>/<random>.webp` to the `MEDIA` bucket (`menucito-media`), stores the public path in `restaurant_appearance.logo_url`, then deletes the previous object (a failed delete is only logged).
- Local: `wrangler dev --local` emulates R2 with Miniflare (data in `apps/api/.wrangler`); no bucket or Cloudflare account is needed. Tests use the Workers-runtime R2 binding.
- Uploads go through the Worker on purpose (no presigned URLs): presigned R2 URLs need S3 API credentials and do not work with the local emulator. Product photos use the same path (an 800x800 WebP is ~50-150 KB).
- Cover (admin `/local`, "Mi local" > Apariencia): available on every plan. Normalized in the browser to a 1200x400 WebP ("cover", center-cropped; PNG, JPG, WebP or GIF, no SVG) and uploaded at once. Stored as `covers/<restaurantId>/<random>.webp` in `restaurant_appearance.cover_url`, same validation and replace order as the logo (`services/covers.ts`).
- Product photos (admin `/menu`): one photo per product, normalized in the browser to an 800x800 WebP ("cover": scaled to fill and center-cropped). Accepted sources: PNG, JPG, WebP, GIF (no SVG). The file input uses `accept="image/*"` without `capture`, so phones offer both camera and gallery. Stored as `products/<restaurantId>/<random>.webp`, same validation and replace order as the logo; deleting a product deletes its photo.

### Plan limits

Plan limits live only in `packages/shared/src/plans.ts` (`PLAN_LIMITS`, `planLimitsFor`); unknown plans get Basic. Basic: up to 40 products, product photos included. Pro: unlimited products. One photo per product on every plan; no category limit. Only creating products is limited (403 `PLAN_LIMIT`): a restaurant above the limit keeps, edits, moves and deletes its products.

Plan flags (`PlanLimits`): `maxProducts` (Basic 40, Pro unlimited), `productPhotos` (both plans), `customIngredients` and `customColors` (both `false` on Basic, `true` on Pro), `cashRegister` (`true` on both plans; turning it off makes every `/api/cash-sessions/*` route answer 403 `PLAN_FEATURE`). `customColors` gates the menu's background and primary colors (see "Menu theme"); cover, description and the featured category have no plan limit. Customizable ingredients are a Pro feature: writing them without the flag answers 403 `PLAN_FEATURE` and changes nothing, while reading is open to every plan. A downgrade never deletes them: the admin shows the saved list read-only inside the locked "Ingredientes" section until the account is Pro again. The admin and the API read the flag from `planLimitsFor(plan)`, never from `plan === "pro"`. In the product editor, Basic accounts see "Ingredientes" and "Extras y variantes" greyed out with the PRO badge and a "Ver plan Pro" link (`ProLock`); "Extras y variantes" is a "Próximamente" placeholder on every plan (no data, no API).


### Order flow and lifecycle

1. **Ordering & Validation**: The diner builds their cart in `apps/web`. In `/<slug>/pedido`, the phone number is validated with Argentine format (`normalizeArWhatsapp`). If the store has paused orders (`acceptingOrders: false`), an informative status banner is shown and submission is disabled. If subtotal is below `minOrderCents`, an alert informs the user and disables submission.
2. **Idempotency & Submission**: On form submission, a client UUID `clientOrderId` is retrieved from or generated in `localStorage` (`getOrCreateToken`) and posted to `POST /api/public/menus/:slug/orders`.
3. **Server Integrity**: The API recalculates all line prices and options against D1. If prices or availability changed in the interim, it responds 409 (`PRICE_CHANGED` or `PRODUCT_UNAVAILABLE`).
4. **Customer Linking & Rate Limiting**: Customers are deduplicated by `restaurant_id + phone`. If a phone has 3 or more active orders (`new`, `preparing`, `ready`), it is throttled with 429 `ORDER_THROTTLED`. IP submissions are limited to 10 requests per minute.
5. **WhatsApp Handoff**: The order is stored with a sequential `#number` per restaurant. The API returns `{ order, whatsappUrl }`. The frontend clears the cart, removes the idempotency token, displays a confirmation screen with `#number`, and triggers handoff to WhatsApp with the pre-filled message.
6. **Owner Operations**: The owner manages orders in `/pedidos` (polling every 5s while visible): the "Activos" board has the columns Nuevos, En preparación, Listos, Enviados (delivery orders only) and Entregados (orders delivered today by `delivered_at`, up to 50), plus an "Individual" list by status for small screens. Board and Individual filter by fulfillment (`?modo=delivery|takeaway`, kept in the URL); the map shows only deliveries. A toast announces new orders on any admin screen. Advance status with optimistic concurrency control (`PATCH /api/orders/:id/status`), choose the courier on a ready delivery order (`POST /api/orders/:id/assign`, which passes it to Enviado), toggle payment (`PATCH /api/orders/:id/payment`), and export history as CSV (`GET /api/orders/export`). The gear opens "Ajustes de pedidos": the messages kept for each status change (delivery, with optional takeaway variants), saved to `order_message_templates`; nothing is sent yet. "Nuevo pedido" loads a counter or WhatsApp order with the public catalog, recalculated prices, payment (cash, transfer or split), tip and "Pago completo"; it starts in Nuevo and shows its source (Web, Local, WhatsApp) across the board, the Individual list and the detail. `/cajas` opens a cash with an initial amount, shows the totals by method, enters delivered cash orders ("Ingresar a la caja"), records movements, pays couriers, gives them change and closes with the counted cash; closed arqueos live in `/cajas/historial` and print from `/cajas/:id/imprimir`. A member marked as a courier also sees "Mis repartos" (`/mis-repartos`): their assigned orders on the way, a one-tap delivery and their day's numbers.

### Plan switch (testing aid)

Until Mercado Pago exists there is no way to pay, so `/plan` ("Plan y pagos") can switch the restaurant between Basic and Pro for free. This lets the plan limits and Pro behavior be tested end to end; it is not a product feature and the future checkout and webhook will replace it. It is guarded by two flags, both off by default:

- `ALLOW_PLAN_SWITCH=true` (API, `apps/api/.dev.vars`): the real guard. Without it `PUT /api/restaurants/me/plan` answers 403 `PLAN_SWITCH_DISABLED` and never changes a plan. It is deliberately absent from `wrangler.jsonc`, so no deployed environment has it unless someone adds it on purpose.
- `VITE_PLAN_SWITCH=true` (admin, build time): only shows or hides the switch button on `/plan`. Without it the page shows the plans and "El pago de planes estará disponible pronto."

Set both together locally; keep both unset in staging and production. Downgrading never deletes or hides products: a restaurant above the Basic limit keeps them all and only new products are blocked (403 `PLAN_LIMIT`).

After pulling schema changes, apply new migrations locally: `pnpm --filter @menucito/api db:migrate:local`.

### Admin panel routes and shell

Every admin page with a restaurant lives inside `AdminShell` (`apps/admin/src/components/shell`), a layout route under `RequireAuth` and `RequireRestaurant`: a 240px sidebar from 1024px, and a top bar with a drawer (native modal `<dialog>`) below it. Both render the same `NavPanel` (restaurant logo or initials, name, plan, sections and "Cerrar sesión"). Navigation items and route matching live in `apps/admin/src/lib/nav.ts`; the menu and the routes are filtered by the member's permissions (`RequirePermission`, with the "No tenés acceso" and deactivated-user screens), and actions the member cannot perform are hidden.

| Route | Section |
| --- | --- |
| `/` | Resumen (public link, WhatsApp, product and category counts) |
| `/pedidos` | Pedidos (tablero con columnas activas, historial con filtros de fecha/estado/pago, detalle, acciones, asignación de repartidor y exportación CSV) |
| `/cajas`, `/cajas/historial`, `/cajas/:id`, `/cajas/:id/imprimir` | Cajas (apertura, caja abierta, movimientos, ingresos de repartidores, pagos, cambio y cierre; historial de arqueos, detalle y reporte A4 imprimible) |
| `/repartidores` | Repartidores (resumen diario de entregados, envíos y propinas por repartidor, con filtro de repartidor y rango de fechas; acciones Pagar y Dar cambio) |
| `/mis-repartos` | Mis repartos (solo con `is_courier`): pedidos en camino ordenados por cercanía, "Ver ruta en Maps", llamar, marcar entregado y los números del día |
| `/menu`, `/menu/products/new`, `/menu/products/:id` | Mi menú |
| `/local` | Mi local |
| `/usuarios/lista`, `/usuarios/roles` | Usuarios (owner only): people with access, and roles with their permission tree |
| `/plan` | Plan y pagos (current plan, the two plans, optional test switch) |
| `/reportes` | Reportes: "Próximamente" placeholder |

Login, sign-up, forgot/reset password, verify email and onboarding render outside the shell. `document.title` is "<Sección> · Menucito".

### Admin environment

| Variable | Purpose |
| --- | --- |
| `VITE_PUBLIC_BASE` | Host shown in the public menu link (`<host>/<slug>`), which opens the menu in a new tab. Default `menucito.com` (placeholder); locally `localhost:4321` |
| `VITE_PLAN_SWITCH` | `true` shows the free plan switch on `/plan` (UI only; the API flag `ALLOW_PLAN_SWITCH` is the real guard). Default off |

### Public web app (`apps/web`)

| Route | Behavior |
| --- | --- |
| `/` | Prerendered placeholder landing ("FUTURA LANDING"); works without the API and without client JavaScript |
| `/<slug>/pedido` | Order detail: cart lines with steppers, breakdown (Productos, Envío, Propina, Total), store pause banner, minimum order check, and form (name, phone, fulfillment, address, payment method with transfer bank details). On a delivery order paid by transfer it offers the tip: 4%, 8%, 10%, 14% or another whole-pesos amount up to $50.000 (none selected by default, and the tip is added to the total without being kept in the cart). Submitting persists the order to the database via `POST /api/public/menus/:slug/orders`, clears the cart, shows confirmation card, and redirects to WhatsApp with the formatted order message |
| `/<slug>` | Server-rendered menu. Reads `GET /api/public/menus/:slug` from the server (no CORS involved). 200 with `Cache-Control: public, max-age=60`; 404 "No encontramos este menú" for an unknown, invalid or reserved slug (the API is not called for the last two); 503 when the API is down or answers 5xx (`no-store`); 301 to the lowercase URL for an uppercase slug |

The menu header shows the cover (or a soft tone of the primary color), the overlapping logo, the name and the description (no Delivery/Retiro selector, which only exists in `/<slug>/pedido`, and no opening-hours label yet). The featured category comes first as a horizontal row; the category nav is sticky and highlights the section in view (with JavaScript off the chips still work as anchors). `<meta name="description">` is the restaurant description, or "Menú de <name>" without one.

#### Menu theme

Only two colors are stored (background and primary, Pro); the rest of the palette (ink, surface, muted, text on primary, accent, danger, ...) is derived by `themeFromColors` in `@menucito/shared` (`packages/shared/src/theme.ts`) with contrast guarantees, and saving is rejected (422) when the primary color has less than 3:1 contrast against the background. The same function is rendered in two ways:

- Web: `Layout.astro` puts `themeCssVars(themeFromColors(colors))` as the `style` of `<body>` on `/<slug>` and `/<slug>/pedido` (the landing and error pages keep the default theme); `global.css` only uses the `--color-*` tokens.
- Admin: the live preview in "Mi local" (`MenuPreview`) applies the same CSS variables, scoped to the phone frame, from the unsaved draft and without network requests.

The cart lives only in the browser: `localStorage` key `menucito:cart:<slug>` (one per restaurant, versioned, tolerant of missing or corrupt data) and the order form is remembered under `menucito:order-form:<slug>`. Nothing is stored or sent to the server. A stored cart is reconciled against the current menu on every page (sold out or removed products are dropped, ingredient ranges and prices use the current values) and the diner is told once. Prices come only from the shared functions in `packages/shared/src/cart.ts`. Not wired yet: the WhatsApp message, `order_events`, delivery fees, minimum order and per-restaurant payment methods (the list is fixed: Efectivo, Transferencia).

Until the "Publicar cambios" flow and the KV copy exist, the menu is read live from the database through the API, so an edit in the admin shows up on a reload (within the 60 seconds of the browser cache). Reserved slugs include the root-domain pages (`precios`, `planes`, `terminos`, `privacidad`, `contacto`).

| Variable | Purpose |
| --- | --- |
| `PUBLIC_API_URL` | API base URL used by the web server to fetch menus and to build absolute logo and photo URLs. Default `http://127.0.0.1:8787`. Read at build and dev time (set it in `apps/web/.env`, gitignored) |

## Environment variables (`apps/api/.dev.vars`)

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signing/encryption secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Public origin of the app. Local: `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (guide below) |
| `RESEND_API_KEY` | Resend API key. Empty = log emails to the console |
| `EMAIL_FROM` | Sender address. Local/no domain: `onboarding@resend.dev` |
| `ALLOW_PLAN_SWITCH` | `true` enables the free plan switch endpoint. Local testing only; never set it in a deployed environment |
| `WEB_ORIGINS` | Comma-separated allowed origins for public order creation and CORS preflight. Default `http://localhost:4321,http://127.0.0.1:4321` |

After editing `.dev.vars`, restart the API dev server.

## Get Google OAuth credentials

1. Go to https://console.cloud.google.com and sign in.
2. Top bar project picker -> **New project** -> name it `menucito` -> **Create**. Select it.
3. Left menu -> **APIs & Services** -> **OAuth consent screen** (may appear as **Google Auth Platform**). Click **Get started**.
   - App name: `Menucito`. User support email: your email. Next.
   - Audience: **External**. Next.
   - Contact information: your email. Next. Accept the policy and **Create**.
4. In the consent screen/Audience section, while the app is in "Testing" status, add your Google account under **Test users** (**Audience** -> **Test users** -> **Add users**). Only test users can sign in until you publish the app.
5. Left menu -> **Clients** (or **APIs & Services** -> **Credentials**) -> **Create client** (**Create credentials** -> **OAuth client ID**).
   - Application type: **Web application**. Name: `Menucito local`.
   - **Authorized JavaScript origins** -> Add URI: `http://localhost:5173`
   - **Authorized redirect URIs** -> Add URI: `http://localhost:5173/api/auth/callback/google`
   - **Create**.
6. Copy the **Client ID** and **Client secret** into `apps/api/.dev.vars`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
7. Restart the API and click "Continuar con Google" on http://localhost:5173/login.

For production add the production origin and redirect URI (`https://<your-domain>/api/auth/callback/google`) to the same client.

## Get a Resend API key

1. Create an account at https://resend.com (the free plan is enough).
2. Dashboard -> **API Keys** -> **Create API Key**. Name: `menucito-local`. Permission: **Sending access**. **Add**.
3. Copy the key (starts with `re_`; it is shown only once) into `apps/api/.dev.vars`:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=onboarding@resend.dev
   ```
4. Restart the API.

Limitation: without a verified domain, Resend only lets you send from `onboarding@resend.dev` and only to the email address of your own Resend account. To email other recipients, add and verify a domain in **Domains** and use an address on it as `EMAIL_FROM`.

## Notes

- Sign up with an already registered email returns an explicit "email already in use" error (product requirement). Better Auth normally hides this when email verification is required (anti-enumeration), so this is a deliberate trade-off implemented in a `before` hook in `apps/api/src/auth.ts`.
- Production (later): `app.` and `api.` subdomains will need cross-subdomain cookies, and Resend needs a verified domain. D1 `database_id` in `apps/api/wrangler.jsonc` is a placeholder for local use.
