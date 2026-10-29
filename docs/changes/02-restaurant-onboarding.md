# 02 · Create my restaurant (onboarding step 1) + first layered REST endpoints

Status: approved
Date: 2026-10-28

## Intent
After login, a user without a restaurant must create one (name, public slug, WhatsApp, delivery options). This also introduces the `restaurants` table and the first own REST endpoints, fixing the layered architecture the rest of the API will follow.

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1), `apps/admin` (React + Vite + TS + Tailwind v4 + shadcn-style components + TanStack Query + React Hook Form + Zod + react-router), `packages/shared` (Zod schemas, imported as `@menucito/shared`). Spec 01 (`docs/changes/01-auth-login.md`) is done: email/password, Google, verify email, reset password, welcome view. Read it and `README.md` for run commands.
- Docs vault (Spanish, Obsidian): `Menucito/`. Read `Menucito/03-arquitectura/Arquitectura-del-backend.md` (MANDATORY architecture), `Modelo-de-datos.md` and `Arquitectura-general.md`. Do not edit the vault except to update `Modelo-de-datos.md` if your schema differs from it.
- UI source of truth: `.design-canvas/project/Onboarding.dc.html` (read it, plus `canvas.json`). Reuse existing tokens/components in `apps/admin/src` (`components/ui/*`, `FormField.tsx`, `AuthLayout.tsx`, `index.css`). Spanish UI copy as in the canvas; code, identifiers and comments in English.
- Architecture rule (non-negotiable): API REST in layers `routes/` (Hono, Zod validation, JSON) -> `services/` (business logic) -> `repositories/` (Drizzle/D1). Plus `middleware/` (requireSession, tenant). No controller classes. Dependencies only go downwards. Repositories scope by `restaurant_id`/owner; the tenant id comes from the session via middleware, never from the request body. Zod schemas and types live in `packages/shared`.
- Existing API files: `apps/api/src/index.ts` (Hono app, `/health`, Better Auth mounted at `/api/auth/*`), `auth.ts` (`createAuth(env, {waitUntil})`, built per request), `env.ts` (`Env` with `DB`), `db/schema.ts` (Better Auth tables: `user`, `session`, `account`, `verification`), `email.ts`. Migrations in `apps/api/migrations` (`0000_init.sql`). Scripts: `db:generate` (drizzle-kit), `db:migrate:local`, `test` (Vitest in the Workers runtime, in-memory D1), `lint`, `typecheck`, `build`.
- Local only: there is no remote Cloudflare D1. Never print or commit `apps/api/.dev.vars`. Do not run `git init` or commit. Do not leave dev servers running when you finish.

## Scope
- In:
  - `restaurants` table + migration (applied locally).
  - API (layered): `GET /api/restaurants/me`, `GET /api/restaurants/slug-available?slug=`, `POST /api/restaurants`.
  - Shared Zod schemas + pure helpers (slug rules, Argentine WhatsApp normalization) with unit tests.
  - Admin: `/onboarding` page per canvas (step 1 only), route guards, and an updated home (`/`) that shows the restaurant.
- Out: logo upload and any file storage (pending, see `docs/changes/03-logo-storage.md`; this change adds NO `logo_url` column and no R2 binding), onboarding steps 2 and 3, categories/products, colors/hours, plans and payments, KV publish, public menu, editing or deleting a restaurant, several restaurants per user, domain purchase (the link prefix is a config constant).

## Spec
Scenarios (Given / When / Then):
1. Given I am logged in without a restaurant, when I open `/`, then I am redirected to `/onboarding`.
2. Given I am on `/onboarding`, when I type the name "Lo de Marta", then the slug field is suggested as `lo-de-marta` (accents removed, lowercase, hyphens) until I edit the slug myself.
3. Given a free slug, when I stop typing (debounce ~400 ms), then I see the "Disponible" message; given a taken or reserved or invalid slug, then I see an error message and cannot continue.
4. Given valid data, when I submit, then the restaurant is created, I land on `/` and see my restaurant name and public link.
5. Given the WhatsApp `011 15 1234-5678`, when I submit, then it is stored as `5491112345678` (digits only, `54` + `9` + area code + number, without leading `0` or `15`); given `+54 9 11 1234-5678` it yields the same value; given an invalid number I see a field error.
6. Given neither "Retiro en el local" nor "Envío a domicilio" is checked, when I submit, then I see an error asking for at least one.
7. Given a slug that was free when checked but taken before I submit (race), when I submit, then the API answers 409 and the form shows the slug-taken error.
8. Given I already have a restaurant, when I POST again, then the API answers 409 and I cannot create a second one; when I open `/onboarding`, then I am redirected to `/`.
9. Given no session, when I call any `/api/restaurants/*` endpoint, then the API answers 401.
10. Given I am logged in with a restaurant, when I reload `/`, then I still see it (data from `GET /api/restaurants/me`); given I have none, `GET /api/restaurants/me` answers 404.
11. Given invalid input (empty name, name over 60 chars, slug outside 3-40 chars or with invalid characters), when I submit, then Zod errors show client-side and the API answers 422 for the same input.

## Design
- Table `restaurants` (Drizzle, snake_case columns, `timestamp_ms` like the existing tables): `id` text PK, `owner_id` text NOT NULL UNIQUE references `user.id` on delete cascade, `slug` text NOT NULL UNIQUE, `name` text NOT NULL, `whatsapp` text NOT NULL (digits `549...`), `delivery` integer boolean NOT NULL, `takeaway` integer boolean NOT NULL, `plan` text NOT NULL default `basic`, `status` text NOT NULL default `trial`, `created_at`, `updated_at`. `owner_id` UNIQUE enforces one restaurant per user for now. `logo_url`, `colors`, `hours_json` come later. The `plan`/`status` values are provisional: keep them as plain text.
- Layers (new files under `apps/api/src`): `routes/restaurants.ts`, `services/restaurants.ts`, `repositories/restaurants.ts`, `middleware/require-session.ts` (resolves the Better Auth session via `createAuth(env).api.getSession`, sets `userId` in the Hono context, 401 otherwise). Mount the router in `index.ts`. Services throw typed domain errors (e.g. `SlugTakenError`, `AlreadyHasRestaurantError`); routes map them to 409/422. Slug uniqueness is enforced by the DB constraint: catch the violation and map it to 409, do not rely only on a prior check.
- Shared (`packages/shared/src`): `restaurant.ts` with `createRestaurantSchema` (name 1-60 trimmed, slug, whatsapp raw string, delivery, takeaway, at least one true), `slugSchema` (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3-40 chars, reserved list: `api, app, admin, www, login, signup, onboarding, health, assets, static, menucito`), `slugify(name)`, `normalizeArWhatsapp(input)`. Normalization: keep digits; drop a leading `54`, then an optional `9`, then a leading `0`; if 12 digits remain, remove the `15` found at index 2, 3 or 4 (first match) so that 10 national digits remain; the result must be 10 digits, output `549` + those digits. Document the known ambiguity in a comment and cover it with tests.
- Endpoints (JSON): `POST /api/restaurants` body `{name, slug, whatsapp, delivery, takeaway}` -> 201 restaurant; `GET /api/restaurants/me` -> 200 restaurant or 404; `GET /api/restaurants/slug-available?slug=` -> `{available: boolean, reason?: "invalid" | "reserved" | "taken"}`. Error body: `{error: {code, message}}`.
- Admin: `pages/OnboardingPage.tsx` (RHF + Zod resolver using the shared schema, TanStack Query for the availability check and the mutation), `lib/restaurant.ts` (query key + hooks), guards `RequireRestaurant` (no restaurant -> `/onboarding`) and `RequireNoRestaurant` (has restaurant -> `/`) next to the existing ones in `components/guards.tsx`; update `main.tsx` routes and `WelcomePage.tsx` (keep "Cerrar sesión"; show restaurant name and link `<PUBLIC_BASE>/<slug>`). `PUBLIC_BASE` comes from `VITE_PUBLIC_BASE` with default `menucito.com` (placeholder, real domain not bought yet). Keep the "Paso 1 de 3 · Tu local" header from the canvas.
- Key decisions: one restaurant per user (UNIQUE `owner_id`); tenant resolved from session, not from the body; WhatsApp stored normalized so the future `wa.me` link needs no processing.

## Tasks
- [x] 1. Shared: `restaurant.ts` (schemas, `slugify`, `normalizeArWhatsapp`, reserved slugs) + Vitest unit tests (add Vitest to `packages/shared` if missing).
- [x] 2. API data: `restaurants` table in `db/schema.ts`, generate and apply the migration locally.
- [x] 3. API layers: `repositories/restaurants.ts`, `services/restaurants.ts` (domain errors), `middleware/require-session.ts`.
- [x] 4. API routes: `routes/restaurants.ts`, mounted in `index.ts`, error mapping (401/404/409/422).
- [x] 5. API tests (Vitest): scenarios 5 (storage), 7, 8, 9, 10, 11 and slug-available (invalid, reserved, taken, free).
- [x] 6. Admin: `lib/restaurant.ts`, guards, `OnboardingPage` per canvas (slug suggestion, debounced availability, error states), routes.
- [x] 7. Admin: updated `WelcomePage`; manual run of scenarios 1-11 in a browser; update `README.md` with the new endpoints; stop any servers you started.

## Verify
- [x] Scenarios 1..11 pass (API and shared ones with Vitest, UI manually in a browser)
- [x] Lint, types, tests and build pass (`pnpm turbo lint typecheck test build`)
- [x] Every new endpoint lives in routes -> services -> repositories (no DB access from routes, no HTTP concerns in services)
- [x] `README.md` updated; `Menucito/03-arquitectura/Modelo-de-datos.md` updated only if the schema differs from it
