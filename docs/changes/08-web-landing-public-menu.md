# 08 · Web app: landing placeholder and public menu at `/<slug>`

Status: draft
Date: 2026-10-29
Depends on: `docs/changes/07-pro-features-ingredients.md` (done). Uses specs 01-04 data (restaurants, categories, products, logo, photos).

## Intent
Create the public web app (`apps/web`, Astro) that sits at the root domain: `menucito.com` shows a placeholder landing that only says "FUTURA LANDING", and `menucito.com/<slug>` shows that restaurant's menu to the diner (read only: logo, name, categories, products with photo, description, price and "Agotado"). The admin panel stays at `app.menucito.com`. This is the first time a restaurant owner can open their own link and see their menu. Ordering (cart, WhatsApp message), the published-menu KV copy, "Publicar cambios", the real landing and the production deploy are later specs.

```
menucito.com          -> apps/web  landing (static, placeholder)
menucito.com/<slug>   -> apps/web  public menu (SSR)
app.menucito.com      -> apps/admin (unchanged)
api (Hono Worker)     -> apps/api   (+ one public read endpoint)
```

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1, R2), `apps/admin` (React + Vite SPA), `packages/shared` (`@menucito/shared`). Specs 01-07 are done: read them in `docs/changes/` and `README.md`. Spec 01 already named `apps/web` (Astro) as the future public app.
- Vault (Spanish, Obsidian) at `Menucito/`: read `03-arquitectura/Arquitectura-general.md` (domains, Astro landing + SSR menu), `Menu-publico-y-WhatsApp.md`, `Arquitectura-del-backend.md` (MANDATORY layered architecture: routes -> services -> repositories) and `Stack-tecnologico.md`. The vault plans to serve the menu from a KV JSON copy; this spec deliberately reads the database through a public API endpoint instead (see Design). Record that decision in the vault, in Spanish, touching only `Menu-publico-y-WhatsApp.md`.
- Existing code to reuse: `packages/shared` (`checkSlug`, `RESERVED_SLUGS`, `formatArs`, catalog types, `planLimitsFor`), the API layers in `apps/api/src` (`routes/categories.ts`, `services/catalog.ts`, `repositories/*`, `routes/http.ts` error mapping), the media route (`/api/media/...`, how logo and photo URLs are built), brand tokens and fonts in `apps/admin/src/index.css`, `lib/restaurant.ts` `publicMenuUrl` and `VITE_PUBLIC_BASE` in the admin.
- UI copy in Spanish; code, identifiers and comments in English. No API contract may expose private data (see scenario 8).
- Local only. Never print or commit `apps/api/.dev.vars`; never read `data_sensible/`. Do not commit or push. Do not deploy.

## Scope
- In:
  - `apps/web` (Astro, SSR through the Cloudflare adapter, wired into pnpm and Turborepo like the other apps).
  - `/` static landing placeholder.
  - `/<slug>` public menu page, mobile first, read only.
  - `GET /api/public/menus/:slug` (no auth) with a minimal public shape, cached briefly.
  - More reserved slugs for the root domain: `precios`, `planes`, `terminos`, `privacidad`, `contacto`.
  - Admin "Resumen": the public link text becomes a real link that opens the menu in a new tab.
  - README (running the web app, env vars) and one vault note.
- Out: cart, ordering, WhatsApp button or message, delivery/takeaway info, opening hours, ingredients and extras on the public page, colors or branding per plan ("Hecho con Menucito" footer), KV publish and the "Publicar cambios" flow (menus are live as soon as they exist), `order_events` and statistics, the real landing, SEO beyond title and description, sitemap, Open Graph images, custom domains, production deploy, DNS, CI/CD.

## Spec
Scenarios (Given / When / Then):
1. Given I open `/`, then I see a page titled "Menucito" with the wordmark "menucito." and the text "FUTURA LANDING", prerendered (it works without the API running) and without client JavaScript.
2. Given a restaurant with slug `mi-local` and products, when I open `/mi-local`, then I see its logo (or the initials avatar when it has none), its name as the `h1`, a category navigation and, per category, an `h2` with the category name and its products in the admin's order.
3. Given a product, then the page shows its photo when it has one, its name, its description when not empty, and its price formatted with `formatArs`; a product with `available = false` is still listed, dimmed, with the text "Agotado" (text, not only color).
4. Given a category without products, then it is not shown at all; given a restaurant with no products at all, then the page shows its header and "Este menú todavía no tiene productos."
5. Given a slug that does not exist, or one that `checkSlug` rejects (invalid or reserved, e.g. `/app`, `/api`, `/a_b`), then the response is HTTP 404 with a friendly page "No encontramos este menú" and a link to `/`; invalid and reserved slugs never reach the API.
6. Given an uppercase slug (`/Mi-Local`), then I am redirected (301) to the lowercase URL.
7. Given the API is unreachable or answers 5xx, then the page answers HTTP 503 with "No pudimos cargar el menú. Probá de nuevo en un momento." and does not cache that response.
8. Given `GET /api/public/menus/mi-local` without any session, then it answers 200 with `{ restaurant: { name, slug, logoUrl }, categories: [{ name, products: [{ name, description, priceCents, imageUrl, available }] }] }`, categories without products are left out, and the body contains no ids, owner, plan, status, WhatsApp, timestamps or ingredients; an unknown or malformed slug answers 404 `RESTAURANT_NOT_FOUND`; the response carries `Cache-Control: public, max-age=60`.
9. Given the public endpoint, then it only reads data of the restaurant with that slug (never another restaurant's) and works for any plan and any `status` value.
10. Given a viewport from 360px to 1280px, then there is no horizontal scroll, the layout is a single centered column of at most 640px, the category navigation is a sticky bar whose chips scroll horizontally inside their own container and jump to the section (`scroll-margin` so the sticky bar does not cover the heading), and every tappable control is at least 44px.
11. Given any menu page, then `document.title` is "<Restaurant name> · Menucito", there is a meta description ("Menú de <name>"), `lang="es"`, one `<main>`, product photos have `width`/`height` and `loading="lazy"` (except the logo) so the layout does not jump, keyboard focus is visible and text contrast is at least 4.5:1.
12. Given the admin "Resumen", then "Tu link" shows the public URL as a link that opens the menu in a new tab (`target="_blank"`, `rel="noopener noreferrer"`); the scheme is `http://` when the host starts with `localhost` or `127.0.0.1` and `https://` otherwise.
13. Given the web app runs locally on its own port, when the admin and the API also run, then a restaurant created or edited in the admin appears on its public page after a reload (within the 60 seconds of the cache header when the browser cache applies).

## Design
- Data source: the web app calls `GET /api/public/menus/:slug` on the API from the server (Astro SSR), not from the browser, so no CORS change is needed. Why not KV now: the KV copy needs a publish step, a KV binding and a "Publicar cambios" UX, which is a spec of its own; the endpoint hides the source behind a stable shape, so moving to KV later changes the API internals, not the web app. Why not reading D1 directly from the web Worker: it would duplicate the repositories and break the layered architecture.
- Public API layers: `routes/public.ts` (mounted at `/api/public`, no `requireSession`), `services/public-menu.ts` (resolves the restaurant by slug, loads categories and products through the existing repositories, drops empty categories, maps to the public shape; logo and photo URLs are returned as the same public paths the admin already uses), reuse of `repositories/*`. The public type `PublicMenu` lives in `packages/shared`. The reserved slug list grows in `packages/shared`; existing restaurants are not migrated (none uses those words today).
- `apps/web`: Astro with `@astrojs/cloudflare`; `src/pages/index.astro` (prerendered) and `src/pages/[slug].astro` (`prerender = false`). Pin versions that are current when you implement, in the style of the other apps' `package.json`. Environment: `PUBLIC_API_URL` (default `http://127.0.0.1:8787`) used for the fetch and to build absolute image URLs (the API serves media). Scripts match the other apps (`dev`, `build`, `lint`, `typecheck` via `astro check`, `test` only if you add pure logic) so `pnpm turbo lint typecheck test build` covers it. Dev port 4321.
- Styling: copy the brand tokens (colors, `Bricolage`/`DM Sans` fonts as the admin loads them, radii) from `apps/admin/src/index.css` into the web app's own CSS; do not import from the admin app and do not create a shared CSS package yet (two consumers). Plain CSS or Tailwind is up to you; keep it light, no client framework and no islands in this spec (the Preact cart island is a later spec).
- Why SSR and not static: a menu changes whenever the owner edits it and new restaurants appear without a rebuild; SSR with a 60-second cache is the vault's choice and keeps one deployment for all tenants.
- Error handling: 404 and 503 are real HTTP statuses (not 200 pages with a message) so caches and monitors behave.
- Admin link: extend `publicMenuUrl` usage in `SummaryPage` only; `VITE_PUBLIC_BASE` for local use is documented as `localhost:4321` in `README.md` and `.dev.vars.example`-style docs, not committed in a `.env` file.

## Tasks
- [x] 1. `packages/shared`: `PublicMenu` types, extra reserved slugs, Vitest tests (reserved list, existing slug tests still pass).
- [x] 2. API: `GET /api/public/menus/:slug` through route -> service -> repository, `Cache-Control`, tests for scenarios 8-9 (shape has no private fields, empty categories dropped, unknown slug, malformed slug, product order, other restaurant's data never returned, no session needed).
- [x] 3. `apps/web`: scaffold (Astro + Cloudflare adapter), Turborepo wiring, landing at `/` with "FUTURA LANDING", `.gitignore` entries.
- [x] 4. Menu page `[slug].astro`: header, sticky category navigation, product list, "Agotado", empty states, 404 / 503 / uppercase redirect, title and meta.
- [x] 5. Admin "Resumen" link (scenario 12), `README.md` (apps, ports, `PUBLIC_API_URL`, `VITE_PUBLIC_BASE=localhost:4321`), vault note `Menu-publico-y-WhatsApp.md` (current state: read through the API until KV exists).
- [x] 6. Manual browser run of scenarios 1-13 at 375px and 1280px (restaurant with and without logo, with and without photos, an "Agotado" product, an empty category, an empty menu, unknown / reserved / uppercase slug, API stopped); stop any servers you started.

## Verify
- [ ] Scenarios 1..13 pass (8-9 with API tests, the rest manually in a browser at 375px and 1280px)
- [x] The public endpoint never returns private fields and never needs a session
- [x] `/` works without the API; unknown and reserved slugs answer a real 404 without calling the API
- [x] No cart, ordering, KV, WhatsApp or branding code added; no horizontal scroll from 360px
- [x] Lint, types, tests and build pass for every app (`pnpm turbo lint typecheck test build`)
- [x] `README.md` and the vault note updated
