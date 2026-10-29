# 03 · Restaurant logo upload (R2 storage)

Status: approved
Date: 2026-10-28
Depends on: `docs/changes/02-restaurant-onboarding.md` (must be done first)

## Intent
Any restaurant, on every plan (Basic and Pro), can upload its logo from its computer (PNG, JPG, WebP, GIF or SVG). The image is normalized in the browser, stored in Cloudflare R2 and shown in the admin. This is the project's first file storage.

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1), `apps/admin` (React + Vite + TS + Tailwind v4 + shadcn-style components + TanStack Query + React Hook Form + Zod + react-router), `packages/shared` (Zod schemas, `@menucito/shared`). Specs 01 (auth) and 02 (restaurant creation, `restaurants` table, first layered endpoints) are done: read both in `docs/changes/` and `README.md`.
- Docs vault (Spanish, Obsidian) at `Menucito/`. Read `03-arquitectura/Arquitectura-del-backend.md` (MANDATORY layered architecture), `Storage-e-imagenes.md`, `Modelo-de-datos.md`, `Planes-y-precios.md` (in `02-negocio/`). Update `Storage-e-imagenes.md` to reflect the decisions below (in Spanish); touch nothing else in the vault.
- UI source of truth: `.design-canvas/project/Local.dc.html` ("Mi local", block "Apariencia", avatar with initials, button "Cambiar logo"). Only the logo part is in scope. DECISION: the logo is available on ALL plans; the canvas already shows the PRO badge only next to "Color principal" (out of scope here), so do NOT show a PRO badge or any lock on the logo control. Spanish UI copy; code, identifiers and comments in English. Reuse existing tokens/components in `apps/admin/src`.
- Architecture rule (non-negotiable): `routes/` (Hono, validation, JSON) -> `services/` (business logic) -> `repositories/` (D1 via Drizzle); R2 access goes through a `storage/` module used by the service only (never from routes). Tenant (restaurant) is resolved from the session via the existing middleware, never from the request.
- Local only: R2 runs through Miniflare under `wrangler dev --local`; no Cloudflare account or API keys needed. Never print or commit `apps/api/.dev.vars`. Do not `git init` or commit. Do not leave dev servers running when finished.

## Scope
- In:
  - `logo_url` column on `restaurants` (migration) and an R2 binding.
  - API: upload, delete and public read of the logo.
  - Browser-side normalization of any accepted image to a 512x512 WebP.
  - Admin: a minimal "Mi local" page (`/local`) with only the "Apariencia > logo" part, and the logo shown on the home page.
  - No plan gate: upload and delete are open to every plan.
- Out: color principal (Pro), opening hours, editing name/slug/WhatsApp/delivery, product photos, signed/direct-to-R2 uploads, custom domain for media, plans and payments, `browser-image-compression` (not needed), AI features.

## Spec
Scenarios (Given / When / Then):
1. Given a restaurant on any plan, when I choose a PNG/JPG/WebP/GIF file on `/local`, then it is resized to fit 512x512 (aspect ratio kept, transparent padding), converted to WebP, uploaded, and the new logo replaces the initials avatar.
2. Given a restaurant on any plan, when I choose an SVG, then it is rasterized in the browser to a 512x512 WebP and uploaded (the raw SVG is never uploaded or served).
3. Given a restaurant with a logo, when I upload another one, then the old object is deleted from R2 and `logo_url` points to the new one.
4. Given a restaurant with a logo, when I click "Quitar logo", then the object and `logo_url` are removed and the initials avatar returns.
5. Given a restaurant on the Basic plan (the default), when I upload, replace or remove a logo, then it works exactly as on Pro: no plan check, no lock, no PRO badge, and the API never answers 403 for plan reasons.
6. Given a file that is not an image (e.g. a `.pdf` renamed `.png`) or an image that cannot be decoded, when I select it, then I see "No pudimos leer esa imagen" and nothing is uploaded.
7. Given an upload that is not a real WebP (bad magic bytes) or whose `Content-Type` is not `image/webp`, when it reaches the API, then it answers 415.
8. Given an upload larger than 1 MB, when it reaches the API, then it answers 413.
9. Given no session, when I call any logo endpoint, then the API answers 401.
10. Given a restaurant with a logo, when anyone requests its public URL, then it is served as `image/webp` with long immutable cache headers and `X-Content-Type-Options: nosniff`; given a missing key, then 404.
11. Given a restaurant with a logo, when I reload `/` or `/local`, then the logo is still shown.
12. Given I am logged in without a restaurant, when I open `/local`, then I am redirected to `/onboarding` (existing guard).

## Design
- Data: add `logo_url` (text, nullable) to `restaurants` via a new migration. Store only the public path (e.g. `/api/media/logos/<restaurantId>/<random>.webp`), not the object key separately: derive the key from it. R2 binding `MEDIA` (bucket `menucito-media`) in `wrangler.jsonc` and in `Env`; local works without creating the bucket. In tests use the Workers-runtime R2 binding.
- Upload path decision: the browser sends the (already compressed, small) WebP to the Worker, which writes it to R2. This deviates from the vault note (signed URL, direct to R2) on purpose: presigned R2 URLs need S3 API credentials and do not work with the local emulator, and a 512x512 logo is tiny. Signed uploads will be reconsidered for product photos. Update the vault note accordingly.
- Endpoints (layered, JSON errors `{error: {code, message}}`): `PUT /api/restaurants/me/logo` (multipart/form-data, field `file`) -> 200 `{logoUrl}`; `DELETE /api/restaurants/me/logo` -> 204; `GET /api/media/*` -> public read of the object from R2 (no auth). Errors: 401, 413, 415, 404.
- Service rules (no plan check): size <= 1 MB; `Content-Type` is `image/webp`; first bytes match `RIFF....WEBP`. Key `logos/<restaurantId>/<random>.webp` (random per upload so caches never go stale). Order on replace: write new object, update DB, then delete the old object (a failed delete must not fail the request; log it).
- Browser normalization (`apps/admin/src/lib/image.ts`): decode via `createImageBitmap` or an `<img>` with an object URL; draw "contain" on a 512x512 transparent canvas; `canvas.toBlob(..., "image/webp", 0.9)`. For SVG load it as `<img>` (scripts do not run in image context); if it has no intrinsic size, assume 512x512. Accept `image/png, image/jpeg, image/webp, image/gif, image/svg+xml` and reject anything else before decoding. No third-party compression library.
- No plan gate: the logo is a feature of every plan (business decision, see `Menucito/02-negocio/Planes-y-precios.md`). Do not read `restaurants.plan` in the logo code. Only "Color principal" (later spec) is Pro-only.
- Admin: `pages/LocalPage.tsx` at `/local` (behind `RequireAuth` + `RequireRestaurant`), `lib/image.ts`, a `LogoUploader` component (avatar with initials fallback, "Cambiar logo", "Quitar logo", loading and error states), `lib/restaurant.ts` mutations that invalidate the restaurant query; `WelcomePage` shows the logo/avatar and a link to "Mi local".

## Tasks
- [x] 1. API data: migration adding `logo_url`, R2 `MEDIA` binding in `wrangler.jsonc` and `Env`, Drizzle schema update.
- [x] 2. API layers: `storage/` R2 module, repository update, service (`uploadLogo`, `removeLogo`, validation, no plan gate), exposing `logoUrl` in `/me`.
- [x] 3. API routes: `PUT/DELETE /api/restaurants/me/logo`, `GET /api/media/*` with cache and `nosniff` headers, error mapping.
- [x] 4. API tests (Vitest, R2 in the Workers runtime): scenarios 3, 4, 5 (Basic plan can upload), 7, 8, 9, 10.
- [x] 5. Admin: `lib/image.ts` (normalization incl. SVG rasterization) + unit-testable pure parts.
- [x] 6. Admin: `LocalPage` + `LogoUploader`, route `/local`, `WelcomePage` update.
- [x] 7. Manual browser run of scenarios 1-12 with a real PNG, JPG, GIF and SVG with the default Basic plan, update `README.md` and `Storage-e-imagenes.md`, stop any servers you started.

## Verify
- [x] Scenarios 1..12 pass (API with Vitest, browser ones manually, including an SVG with an embedded `<script>` that must not execute and must not be stored)
- [x] Lint, types, tests and build pass (`pnpm turbo lint typecheck test build`)
- [x] Storage code is only reachable through service -> `storage/` (not from routes)
- [x] `README.md` and `Menucito/03-arquitectura/Storage-e-imagenes.md` updated
