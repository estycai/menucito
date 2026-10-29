# 07 · Pro features in the admin: locked state and customizable ingredients

Status: draft
Date: 2026-10-28
Depends on: `docs/changes/06-plan-switch.md` (must be done first: the plan switch is how a Basic account tries Pro)

## Intent
Pro-only features appear in the admin for every account, but greyed out and not usable on Basic, with a clear way to see the Pro plan. Pro accounts use them. The first real Pro feature is customizable ingredients on a product (included quantity, min, max and extra price per unit, e.g. "Bacon: includes 1, +$1.500 each extra"), configured in the product editor. "Extras y variantes" appears in the same locked pattern as a placeholder only. The ingredient data model, the plan check and the editor are in scope; ordering them from the public menu is not (the public menu does not exist yet).

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1, R2), `apps/admin` (React + Vite + TS + Tailwind v4 + shadcn-style components + TanStack Query + React Hook Form + Zod + react-router), `packages/shared` (`@menucito/shared`). Specs 01-06 are done: read them in `docs/changes/` and `README.md`.
- Vault design (Spanish, Obsidian) at `Menucito/`: read `03-arquitectura/Personalizacion-de-ingredientes.md` (fields and rules), `Modelo-de-datos.md` (planned `ingredients` table), `02-negocio/Planes-y-precios.md` (what is Pro) and `03-arquitectura/Arquitectura-del-backend.md` (MANDATORY layered architecture: routes -> services -> repositories). Update `Modelo-de-datos.md` (ingredients table now exists, `extra_price` -> `extra_price_cents`) and `Personalizacion-de-ingredientes.md` only where this spec decides differently, in Spanish; touch nothing else in the vault.
- Plan facts live in `packages/shared/src/plans.ts` (`PLAN_LIMITS`, `planLimitsFor`); plan checks for catalog writes live in `apps/api/src/services/catalog.ts` (`PLAN_LIMIT`). The plan reaches the admin through `useMyRestaurant`. The product editor is `apps/admin/src/pages/ProductEditorPage.tsx` (photo uploader already branches on `productPhotos`). `components/ProBadge.tsx` exists. Money is integer ARS cents everywhere (`price_cents`, `formatArs`).
- UI copy in Spanish; code, identifiers and comments in English. Do not invent prices.
- Local only. Never print or commit `apps/api/.dev.vars`; never read `data_sensible/`. Do not commit or push. Do not leave dev servers running when finished.

## Scope
- In:
  - A reusable locked-feature pattern in the admin (`ProLock`) for Basic accounts.
  - `customIngredients` flag in `PLAN_LIMITS` (`false` on Basic, `true` on Pro).
  - `ingredients` table (D1 migration), shared types and Zod schema, API to read and replace a product's ingredients (Pro only for writes).
  - "Ingredientes" section in the product editor: editable on Pro, locked on Basic.
  - "Extras y variantes" shown locked on every plan as a "Próximamente" placeholder (no data, no API).
- Out: ordering or showing ingredients in the public menu, the price calculation function and the WhatsApp message (they ship with the public menu spec), extras and variants (option groups) themselves, colors, brand removal, statistics, AI menu import, plan checks on any section not listed here (Estadísticas stays open to Basic), drag-and-drop reordering, ingredient photos or icons, a "quitar descuenta" discount.

## Spec
Scenarios (Given / When / Then):
1. Given a Pro account, when I open the product editor of a saved product, then "Ingredientes" is an editable section; on a new product it is shown with a note "Guardá el producto para agregar ingredientes." and no inputs.
2. Given a Basic account, when I open the product editor, then "Ingredientes" and "Extras y variantes" are visible but greyed out with the "PRO" badge, a one-line description of the feature and a "Ver plan Pro" link to `/plan`; none of their controls can be focused or activated.
3. Given a locked section, then it is hidden from assistive tech as interactive content: its inputs are not rendered (a static example is shown instead), the section keeps a readable heading, and the lock reason is exposed as text ("Disponible en el plan Pro"), not only through color or opacity.
4. Given a Pro account in the editor, when I add an ingredient with name "Bacon", included 1, min 0, max 3 and extra price $1.500 and save, then it persists, reloads in the same order and shows "Bacon · incluye 1 · mín 0 · máx 3 · +$1.500 c/u extra".
5. Given the ingredient form, then the rules from the vault apply and each violation shows an inline Spanish message: name required (max 40 chars), `min <= included <= max`, `max >= 1`, quantities are integers from 0 to 99, extra price is zero or more, at most 20 ingredients per product, no duplicate name inside a product (case-insensitive).
6. Given I edit, remove or reorder ingredients with the up/down buttons used elsewhere (`ReorderButtons`), when I save, then the product's list is replaced as a whole and the order is kept; removing an ingredient asks for confirmation like other deletes.
7. Given the API, when `PUT /api/products/:id/ingredients` is called with a valid list by a Pro account, then it replaces the product's list and answers the new list; by a Basic account, 403 `PLAN_FEATURE` and nothing changes; for a product of another restaurant or an unknown id, 404 `PRODUCT_NOT_FOUND`; with an invalid list, 422 `VALIDATION_ERROR`; without a session, 401.
8. Given a product has ingredients, when I list the catalog (`GET /api/categories`) or load a product, then each product carries its `ingredients` array (empty when none), on every plan.
9. Given a Pro account with ingredients that downgrades to Basic (via the spec 06 switch), then nothing is deleted: the editor shows the saved ingredients inside the locked section, read-only, and the API refuses to change them until the account is Pro again.
10. Given I delete a product or its category is removed, then its ingredients are deleted with it (no orphans).
11. Given a 375px touch viewport and a 1280px desktop, then the ingredient rows stack on mobile, there is no horizontal scroll from 360px, every control is at least 44px, focus is visible, and the locked sections keep contrast of 4.5:1 for their text.
12. Given I switch plan on `/plan`, when I go back to the editor, then the sections reflect the new plan without reloading the page.

## Design
- Plans (`packages/shared/src/plans.ts`): add `customIngredients: boolean` to `PlanLimits` (`basic: false`, `pro: true`); admin and API read it from there, never from `plan === "pro"`.
- Data (`apps/api`): new table `ingredients (id, product_id -> products ON DELETE CASCADE, name, included_qty, min_qty, max_qty, extra_price_cents, position)` in a new migration (follow `0003_catalog` for style, ids and timestamps). Deviation from the vault, to record in `Modelo-de-datos.md`: `extra_price` -> `extra_price_cents` (integer ARS cents, like `price_cents`).
- Shared: `ingredientSchema` and `replaceIngredientsSchema` (`{ ingredients: Ingredient[] }`, max 20) with the vault rules and Spanish messages in `CATALOG_MESSAGES`; `Ingredient` type; `Product` gains `ingredients: Ingredient[]`. Vitest tests for every rule in scenario 5.
- API layers: repository `ingredients` (list by product, replace in one D1 batch so a failure leaves the old list), service function in `catalog.ts` (or a sibling service) that resolves the product through its restaurant, checks `planLimitsFor(plan).customIngredients` and throws `PlanFeatureError` (`code: "PLAN_FEATURE"`, mapped to 403 in `STATUS_BY_CODE`), and a route in `routes/products.ts`. Category/product reads join ingredients in one extra query, not one per product.
- Why replace-the-whole-list and not per-ingredient CRUD: the editor saves the product form once, order is part of the list, and a single atomic replace avoids half-saved states and reorder races. The cap of 20 keeps the batch small.
- Admin locked pattern: `components/ProLock.tsx` takes `title`, `description`, `children` (the static example) and renders a greyed card with `ProBadge`, "Disponible en el plan Pro" and a "Ver plan Pro" link to `/plan`. Locked content is rendered as a non-interactive example (no real inputs), so there is nothing to focus; use `inert` only on decorative preview markup. The same component serves "Extras y variantes" ("Próximamente" copy there instead of the example).
- Admin editor: `components/IngredientsEditor.tsx` (list + add/edit form with React Hook Form + Zod from shared, `ReorderButtons`), saved with its own mutation `useReplaceIngredients` that invalidates the catalog query, and shown only for saved products. It sits below "Datos básicos" in `ProductEditorPage`; the existing product form and its save flow are not changed.
- Why `ProLock` shows a static example instead of disabled inputs: disabled form fields confuse screen readers and look broken; an example explains the feature and the upgrade path in one glance.

## Tasks
- [ ] 1. `packages/shared`: `customIngredients` in `PLAN_LIMITS`, ingredient schemas, types, messages + Vitest tests.
- [ ] 2. API: migration + Drizzle schema for `ingredients`, repository, service rules (plan check, ownership, replace), `PUT /api/products/:id/ingredients`, catalog reads carry `ingredients`; API tests for scenarios 7-10 (Pro and Basic, other restaurant, invalid list, cascade, downgrade keeps data).
- [ ] 3. Admin: `ProLock`, `IngredientsEditor`, `useReplaceIngredients`, wiring in `ProductEditorPage` (locked on Basic, editable on Pro, "guardá primero" on new products), locked "Extras y variantes".
- [ ] 4. Docs: `README.md` (endpoint table, plan flags), vault `Modelo-de-datos.md` and `Personalizacion-de-ingredientes.md` (in Spanish, only the decisions above).
- [ ] 5. Manual browser run of scenarios 1-12 at 375px and 1280px on Basic and Pro (switch plan on `/plan`, spec 06), including a downgrade with saved ingredients; stop any servers you started.

## Verify
- [ ] Scenarios 1..12 pass (4-10 with shared and API tests where noted, the rest manually in a browser)
- [ ] Basic cannot write ingredients through the API even with a hand-made request
- [ ] Locked sections have no focusable controls and expose "Disponible en el plan Pro" as text
- [ ] No data lost on downgrade; no orphan rows after deleting a product
- [ ] No public menu, price calculation or option-group code added
- [ ] Lint, types, tests and build pass (`pnpm turbo lint typecheck test build`)
- [ ] `README.md` and the two vault notes updated
