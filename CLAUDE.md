# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Menucito is a multi-tenant digital menu and ordering SaaS for restaurants (Argentina). `README.md` is the detailed reference (setup, full endpoint table, error codes, plan limits); this file covers what you need to be productive fast.

## Commands

pnpm 12 + Turborepo, Node 22+. Workspaces: `apps/api`, `apps/admin`, `apps/web`, `packages/shared`.

```bash
pnpm install
pnpm turbo lint typecheck test build        # full check, run before finishing a change
pnpm --filter @menucito/api exec vitest run test/orders-owner.test.ts           # single file
pnpm --filter @menucito/api exec vitest run test/orders-owner.test.ts -t "name" # single test
```

First-time local setup:

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @menucito/api db:migrate:local   # re-run after pulling new migrations
```

Run three terminals: `pnpm --filter @menucito/api dev` (:8787), `pnpm --filter @menucito/admin dev` (:5173), `pnpm --filter @menucito/web dev` (:4321). Local D1/R2 are Miniflare state in `apps/api/.wrangler`; no Cloudflare account needed. There is no seed script.

DB changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @menucito/api db:generate` (migrations in `apps/api/migrations/`). Tests apply them via `test/apply-migrations.ts`.

## Architecture

- **`packages/shared`**: zod schemas and pure helpers (cart, orders, delivery quoting, hours, plans, permissions...). Consumed as source (`main: ./src/index.ts`, no build). The API validates with them, admin forms use them via react-hook-form, web uses them for cart and pricing. The API always recomputes order totals server-side (409 `TOTAL_MISMATCH`).
- **`apps/api`**: Hono on Cloudflare Workers, D1 (Drizzle, SQLite) and R2 (`MEDIA`). Strict layering: `routes/` (HTTP + zod) -> `services/` (business rules, domain errors in `services/errors.ts`) -> `repositories/` (Drizzle). Only services touch `storage/media.ts`. Services and repositories are factories (`createXService(repo, now, generateId)`) so tests can inject dependencies.
- **`apps/admin`**: React 19 + Vite + Tailwind 4 + TanStack Query + react-router. Talks to the API same-origin at `/api` (Vite proxy), Better Auth client in `lib/auth-client.ts`.
- **`apps/web`**: Astro SSR on Cloudflare + Preact islands. Fetches the public menu server-side from the API (`PUBLIC_API_URL`); the browser posts orders cross-origin to `POST /api/public/menus/:slug/orders`. Order flow ends in a WhatsApp hand-off (`whatsappUrl`); no online payments exist yet.

### Multi-tenancy
Every table is keyed by `restaurant_id`. The tenant ALWAYS comes from the session (`c.var.member.restaurantId`), never from the request body. Ids from another restaurant answer 404, never 403.

### Permissions
- Catalog of keys (`<section>.<action>`, e.g. `orders.status`, `menu.edit`) lives in `packages/shared/src/permissions.ts`. Sub-permissions only count when the section `.view` is granted. Adding a key needs no migration.
- The Owner is the member with the system role "Dueño" (all keys). Users/roles and plan changes are owner-only, not assignable.
- **Every owner-API route must declare exactly one guard**: `requirePermission(key)`, `requireOwner` or `allowAnyMember`. `apps/api/test/route-guards.test.ts` fails otherwise, and new routes must be added to the `OWNER_ROUTES` table in `apps/api/test/route-permissions.ts`.
- Admin gating mirrors this in `apps/admin/src/lib/access.ts`, `nav.ts` and `components/guards.tsx`, fed by `access` from `GET /api/restaurants/me`.

### Plans
Defined ONLY in `packages/shared/src/plans.ts`. Read flags through `planLimitsFor(plan)`, never `plan === "pro"`. Errors: 403 `PLAN_LIMIT` (product count), 403 `PLAN_FEATURE`. Downgrades never delete data; the public menu hides Pro data when the plan lacks it. `PUT /api/restaurants/me/plan` is a free switch gated by API `ALLOW_PLAN_SWITCH=true` (deliberately absent from `wrangler.jsonc`) and admin `VITE_PLAN_SWITCH=true`.

### Delivery and maps
`deliveryMode` is `flat` or `zones` (`quoteDelivery` in shared `delivery.ts`). Zones mode needs store lat/lng. The API server key calls Places API (New) autocomplete/details and Geocoding v3 only (`apps/api/src/google-maps.ts`); an empty key returns 503 `MAPS_UNAVAILABLE`. Browsers use `@googlemaps/js-api-loader` pinned to 2.1.3 in both frontends; keep them on the same version. It is prebundled in `apps/web/astro.config.mjs` (`optimizeDeps.include`) because the dynamic import 404s in dev otherwise.

### Media
Uploads go THROUGH the Worker (no presigned URLs). The browser normalizes to WebP (logo 512x512, cover 1200x400, product 800x800); the Worker validates <=1MB and the RIFF/WEBP signature. Served by public `GET /api/media/*`.

## Conventions and gotchas

- Error body is `{"error":{"code","message",...}}`. Prices are integer ARS cents. Timezone is `America/Argentina/Buenos_Aires`. WhatsApp numbers are stored normalized as `549` + area + number.
- Code, comments and docs are in English. User-facing strings and API messages are Spanish (rioplatense: "Tu link", "Mi local", "Agotado").
- Conventional commits, scoped, lowercase imperative (`feat(api):`, `fix(web):`, `refactor(admin):`, `docs:`). Changes are spec-first in `docs/changes/NN-*.md` (gitignored, local only).
- **Auth origin**: `BETTER_AUTH_URL` must be the admin origin (`http://localhost:5173`), not 8787. Cookies only work because Vite proxies `/api`; hitting :8787 from a browser breaks auth.
- **CORS**: the public order endpoint reads `WEB_ORIGINS` (comma-separated, e.g. `http://localhost:4321`) from `.dev.vars`. If it is missing, order submit from the local web is blocked.
- Empty `RESEND_API_KEY` logs `[email:dev] {...link}` in the API terminal instead of sending. Empty `GOOGLE_CLIENT_ID/SECRET` disables the Google provider.
- **D1 has no transactions**: multi-step writes use `db.batch` (role permission replace, featured category swap, ingredients replace, order creation).
- Order status moves forward only (steps may be skipped), takeaway cannot go `sent`, `cancelled` is allowed from any active state. Concurrency uses `expectedStatus` (409 `CONCURRENT_MODIFICATION`). Rate limits: 3 active orders per phone, 10/min per IP.
- Deactivating a member deletes its sessions; changing a password deletes all that user's sessions. One restaurant per user; email is unique across accounts (409 `EMAIL_IN_USE`).
- Public menu: only one featured category per restaurant (partial unique index); the featured one is not repeated in `categories`; empty categories are omitted.
- `apps/api` script `auth:schema` points to `src/auth-cli.ts`, which does not exist. Better Auth tables are hand-managed in `src/db/schema.ts` via drizzle migrations.
- Astro `~7.3.8` and `@astrojs/cloudflare ~14.3.4` are pinned together for Node 22.12+; raise both at once.
- API tests run in the Workers runtime (`@cloudflare/vitest-plugin`) with in-memory D1/R2 and a 30s timeout (scrypt is slow). Admin/web/shared tests are colocated `*.test.ts` next to pure helpers; UI components are not unit-tested.
- The repo path contains spaces; quote it in shell commands.
