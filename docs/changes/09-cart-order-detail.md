# 09 · Public menu cart and order detail (the step before the WhatsApp message)

Status: done
Date: 2026-10-29
Depends on: `docs/changes/08-web-landing-public-menu.md` (done), `docs/changes/07-pro-features-ingredients.md` (done, ingredients data).

## Intent
A diner opens `menucito.com/<slug>`, adds products to a cart (customizing ingredients when the restaurant is on Pro), and continues to an order detail page `menucito.com/<slug>/pedido` where they review the lines, change quantities, and fill in name, pickup or delivery, address and payment method, seeing the total. The flow ends there: the "Enviar pedido" button is visible but disabled. Building the WhatsApp message and opening `wa.me` is the next spec, so nothing is sent anywhere and nothing is stored on the server.

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers), `apps/admin` (React SPA), `apps/web` (Astro SSR, public site: landing `/` and read-only menu `/<slug>`), `packages/shared` (`@menucito/shared`). Specs 01-08 are done: read them in `docs/changes/` and `README.md`, especially 07 (ingredients) and 08 (web app, public endpoint).
- Vault (Spanish, Obsidian) at `Menucito/`: read `03-arquitectura/Menu-publico-y-WhatsApp.md` (diner flow, WhatsApp message example) and `Personalizacion-de-ingredientes.md` (calculation rules: `extra = max(0, qty - included_qty) * extra_price`, unit price = base + extras, line total = unit price * quantity; removing does not discount). The price functions live in `packages/shared` so the later WhatsApp message and the cart share them. Update `Menu-publico-y-WhatsApp.md` (current state) in Spanish; touch nothing else in the vault.
- Existing code to reuse: `apps/web/src/pages/[slug].astro` and `src/lib/menu.ts` (SSR fetch of `GET /api/public/menus/:slug`, 404/503 handling, uppercase redirect), `apps/web/src/styles/global.css` (brand tokens), `packages/shared` (`formatArs`, `Ingredient`, `ingredientSchema`, `planLimitsFor`, `PublicMenu` types in `public-menu.ts`, `checkSlug`), API `services/public-menu.ts` and `routes/public.ts`, the native `<dialog>` drawer pattern of `apps/admin/src/components/shell/NavDrawer.tsx` (focus containment, Escape, scroll lock, focus return).
- UI copy in Spanish; code, identifiers and comments in English. Money is integer ARS cents. Orders never touch the server: no new write endpoint, no database change.
- Local only. Never print or commit `apps/api/.dev.vars`; never read `data_sensible/`. Do not commit or push. Do not deploy.

## Scope
- In:
  - Public API additions: product `id` (opaque, needed as the cart key), restaurant `delivery` and `takeaway`, and per-product `ingredients` (only when the restaurant's plan has `customIngredients`; empty list otherwise).
  - Price and cart logic in `packages/shared` (pure functions, tested) and the order-details Zod schema.
  - `apps/web`: Preact islands (adding to cart, ingredient sheet, cart bar, order detail), cart persisted in the browser, and the SSR page `/<slug>/pedido`.
  - README and the vault note.
- Out: building or sending the WhatsApp message, `wa.me`, `order_events` and statistics, any server-side order storage, delivery fees, minimum order, per-product notes, coupons, restaurant open/closed hours, per-restaurant payment method settings (fixed list for now), disabling orders for lapsed subscriptions, option groups / extras / variants, accounts for diners, KV publish, deploy.

## Spec
Scenarios (Given / When / Then):
1. Given a menu page, when a product is available and has no customizable ingredients, then it shows an "Agregar" button (44px or taller); tapping it adds one unit and the control becomes a quantity stepper (− N +) that can go back to zero and remove the line.
2. Given a product marked "Agotado", then it has no add control and cannot enter the cart.
3. Given a restaurant on Pro and a product with ingredients, when I tap the product's add control, then a bottom sheet (native `<dialog>`, focus contained, Escape and backdrop close it, focus returns to the control) shows the product name, one row per ingredient with a stepper limited to its min and max starting at its included quantity, the extra shown as "+$1.500" once the quantity is above the included one, a product quantity stepper, and a primary button "Agregar · $<total>" whose total updates live.
4. Given the sheet, when I confirm, then the line enters the cart with the chosen quantities; two additions of the same product with the same ingredient quantities merge into one line (quantity adds up), different quantities make separate lines; a line holds at most 20 units and the cart at most 30 lines (excess is refused with a short message).
5. Given a restaurant on Basic (or a product without ingredients), then no sheet is ever shown and the public data carries no ingredients for it, even if ingredients were saved before a downgrade.
6. Given a non-empty cart, then a sticky bar at the bottom shows "Ver pedido · N productos · $total" and links to `/<slug>/pedido`; with an empty cart the bar is hidden; the menu content is not covered by it (bottom padding).
7. Given I reload the menu or come back later in the same browser, then the cart is restored (stored per slug in `localStorage`); when the stored cart references a product that no longer exists or is now "Agotado", it is dropped, when a price or ingredient range changed the current values are used, and a short notice "Actualizamos tu pedido porque el menú cambió." appears once.
8. Given I open `/<slug>/pedido`, then I see the restaurant name, a link "← Volver al menú", one row per cart line with product name, a summary of changes (e.g. "Bacon x2 (+$1.500)", "Sin cebolla"; only ingredients that differ from the included quantity), a quantity stepper, the line total and a remove button, then the order total.
9. Given an empty cart on `/<slug>/pedido`, then I see "Tu pedido está vacío." and a link back to the menu; the form is not shown.
10. Given the order form, then it has: "Tu nombre" (required, up to 60 characters), a choice "Retiro" / "Envío" built from the restaurant's `takeaway` and `delivery` flags (a single available option is preselected and shown as text), "Dirección" (required only when "Envío" is chosen, up to 120 characters), and "Forma de pago" with "Efectivo" and "Transferencia" (required). Errors are Spanish and appear inline after the field is touched or after a submit attempt; fields are labelled and errors are announced (`aria-describedby`).
11. Given the form, then its values (not the cart) are also remembered in `localStorage` for the next visit on this browser and can be edited freely.
12. Given a valid form and a non-empty cart, then the page shows the total and the button "Enviar pedido" stays disabled with the text "El envío por WhatsApp llega en el próximo paso."; nothing leaves the browser (no network request is made on interaction).
13. Given the price rules, then for "Hamburguesa completa" at $9.000 with Bacon (included 1, extra $1.500) chosen 2 times and Cebolla (included 1, min 0) chosen 0 times, the unit price is $10.500, and 2 units cost $21.000 (removing never discounts); the same function is used by the sheet, the cart bar, the order detail and (later) the message.
14. Given `/<slug>/pedido` with an unknown, invalid or reserved slug, then it behaves like the menu page (404, no API call for invalid or reserved slugs); with the API down it answers 503; the URL's uppercase slug redirects (301) to lowercase.
15. Given a viewport from 360px to 1280px, then there is no horizontal scroll, the column is at most 640px, every control is at least 44px, focus is visible, steppers have accessible names ("Quitar una unidad de Bacon", "Agregar una unidad de Bacon") and quantities are announced politely (`aria-live="polite"` on the totals); `document.title` on the order page is "Tu pedido · <Restaurant name> · Menucito".
16. Given JavaScript is disabled, then the menu still renders and reads (as in spec 08); adding to the cart requires JavaScript and the page says so in a `<noscript>` note near the first product.

## Design
- Public API (`apps/api`, `packages/shared/src/public-menu.ts`): `restaurant` gains `delivery` and `takeaway`; each product gains `id` (the existing product id, opaque and not sensitive) and `ingredients: { name, includedQty, minQty, maxQty, extraPriceCents }[]`, empty unless `planLimitsFor(plan).customIngredients`. This relaxes the "no ids" rule of spec 08 for products only; the endpoint still never returns owner, plan, status, WhatsApp, timestamps or restaurant id. Update the API tests of spec 08 and add tests for the new fields (Pro with ingredients, Basic with stored ingredients returns none).
- Shared logic (`packages/shared/src/cart.ts`): `unitPriceCents(product, quantities)`, `lineTotalCents`, `cartTotalCents`, `lineKey(productId, quantities)` (stable signature of the non-default choices), `normalizeQuantities` (clamps to min/max, fills included defaults), `describeChanges(product, quantities)` (the "Bacon x2 (+$1.500)" / "Sin cebolla" lines), cart types and limits, and `orderDetailsSchema` (name, fulfillment, address required for delivery, payment) with Spanish messages. Vitest covers every price rule, the merge key, clamping, limits and the schema, including the worked example of scenario 13. No React or DOM code in `shared`.
- Web islands: add `@astrojs/preact` (vault choice, ~10 KB) and a tiny cart store module in `apps/web/src/lib/` backed by `localStorage` (key `menucito:cart:<slug>`, versioned, tolerant of missing or corrupt storage), shared by all islands through a small store (an Astro-recommended store library is fine) so the add controls, the bar and the order page stay in sync, also across tabs (`storage` event). Islands: `AddControl` (per product), `IngredientSheet`, `CartBar`, `OrderDetail`. The server renders the menu HTML; islands hydrate with `client:load` for the bar and `client:visible` for per-product controls only if it measurably helps, otherwise `client:load` everywhere (keep it simple).
- Reconciliation: the menu data the islands need (ids, prices, availability, ingredients) is embedded in the page by the server render, so `/<slug>/pedido` refetches it through the same SSR path and reconciles the stored cart against it (scenario 7) before showing anything.
- `/<slug>/pedido`: new SSR page `apps/web/src/pages/[slug]/pedido.astro` (or the router layout the Astro version prefers) reusing `lib/menu.ts` for fetch, 404/503 and redirect so the three behaviors cannot drift; `Cache-Control` follows spec 08 for success and `no-store` for errors.
- Why the cart lives in the browser: orders end in WhatsApp, not on our server (vault); a server cart would need sessions, storage and cleanup for no benefit. Why `localStorage` per slug and not one global cart: a diner may open two restaurants, and a cart must never mix lines of different restaurants.
- Why the button is disabled instead of hidden: the diner's full path is testable end to end now, and the next spec only wires the button to the message builder.
- Payment methods are a fixed list because there is no restaurant setting for them yet; a per-restaurant list is a later spec.

## Tasks
- [x] 1. `packages/shared`: `cart.ts` (price and cart functions, types, limits), `orderDetailsSchema`, public types updated, Vitest tests incl. scenario 13.
- [x] 2. API: public endpoint returns product `id`, `delivery`, `takeaway` and plan-gated `ingredients`; update and extend `test/public-menu.test.ts` (scenarios 5 and the shape).
- [x] 3. `apps/web`: Preact integration, cart store, `AddControl`, `IngredientSheet` (native dialog), `CartBar`, `<noscript>` note.
- [x] 4. `apps/web`: `/<slug>/pedido` page with `OrderDetail` (lines, steppers, remove, total, form, validation, disabled button), empty state, 404/503/redirect parity, titles.
- [x] 5. `README.md` (web routes, cart storage key, what is not wired yet) and vault note `Menu-publico-y-WhatsApp.md` (current state, in Spanish).
- [x] 6. Manual browser run of scenarios 1-16 at 375px and 1280px: a Pro restaurant with ingredients (create test ingredients in the admin and delete them afterwards), a Basic one (switch plan on `/plan`), Agotado product, merge vs separate lines, reload persistence, a menu edit that invalidates the cart, delivery-only / takeaway-only / both, keyboard in the sheet, JavaScript disabled; stop any servers you started.

## Verify
- [x] Scenarios 1..16 pass (13 and the schema with Vitest, API shape with API tests, the rest manually in a browser)
- [x] Prices come only from the shared functions; no price arithmetic in components
- [x] Nothing is sent or stored on the server; no network request on cart or form interaction (check the Network tab)
- [x] A Basic restaurant never exposes ingredients publicly; the public endpoint still leaks no private fields
- [x] No WhatsApp message, `wa.me`, KV or `order_events` code added; no horizontal scroll from 360px
- [x] Lint, types, tests and build pass for every app (`pnpm turbo lint typecheck test build`)
- [x] `README.md` and the vault note updated
