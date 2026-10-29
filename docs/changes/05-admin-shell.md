# 05 · Admin panel shell (persistent navigation)

Status: draft
Date: 2026-10-28
Depends on: `docs/changes/04-menu-catalog.md` (must be done first)

## Intent
Every admin page with a restaurant lives inside one persistent app shell: a sidebar on desktop and a top bar with a drawer on mobile, both showing the restaurant logo (or initials), its name and its plan, and linking every panel section. Today each page is an isolated screen with "Volver al inicio", the logo is only visible on the home and `/local`, switching sections means going back to the home, and there is no navbar. The home becomes "Resumen". Sections that do not exist yet are reachable and show "Próximamente". Frontend only: no API change.

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1, R2), `apps/admin` (React + Vite + TS + Tailwind v4 + shadcn-style components + TanStack Query + React Hook Form + Zod + react-router), `packages/shared` (`@menucito/shared`). Specs 01-04 are done: read them in `docs/changes/` and `README.md`.
- UI source of truth: the `<nav aria-label="Panel">` sidebar in `.design-canvas/project/MiMenu.dc.html` (identical in `Resumen`, `Local`, `QR`, `Estadisticas`, `Plan` and `ProductoEditor.dc.html`): wordmark "menucito.", restaurant card (36px avatar with initials, name, "Plan Básico"), items "Resumen", "Mi menú", "Mi local", "Link y QR", "Estadísticas" (black "PRO" pill), "Plan y pagos", and "Cerrar sesión" pushed to the bottom; 44px items, active item on `#FFEDD5` with `#9A3412` bold text. Home content: `Resumen.dc.html`. Board list: `canvas.json`. The canvas is desktop-only at 1280px; adapt it, do not copy fixed widths. Spanish UI copy; code, identifiers and comments in English.
- Existing code to reuse, not duplicate: `main.tsx` (routes), `components/guards.tsx` (`RequireAuth`, `RequireRestaurant`), `pages/WelcomePage.tsx` (public link, `formatWhatsapp`, "Enviar mensaje de prueba", sign-out mutation), `components/RestaurantAvatar.tsx`, `components/ProBadge.tsx`, `lib/restaurant.ts` (`useMyRestaurant`, `publicMenuUrl`, `RESTAURANT_KEY`), `lib/session.ts` (`useSession`, `SESSION_KEY`), `lib/plans.ts` (`planName`), `lib/catalog.ts` (`useCatalog`, its `usage`), `index.css` tokens, `components/ui/*`.
- Restaurant data for the shell comes from the existing `useMyRestaurant` query (already loaded by `RequireRestaurant`, and invalidated by the logo mutations, so a new logo shows in the shell at once). No new endpoint, no API change, no `packages/shared` change, no vault change.
- Local only. Never print or commit `apps/api/.dev.vars`; never read `data_sensible/`. The project is a git repo: do not commit or push. Do not leave dev servers running when finished.

## Scope
- In:
  - `AdminShell` layout route (`<Outlet />`) inside `RequireAuth` + `RequireRestaurant`, wrapping `/`, `/menu`, `/menu/products/*`, `/local` and the new placeholder routes.
  - Desktop sidebar (canvas nav) and mobile top bar + accessible drawer with the same navigation.
  - "Cerrar sesión" moves from the home into the shell.
  - "Resumen" at `/` replaces "Bienvenido" (`WelcomePage`), with real data only.
  - Placeholder pages for "Link y QR" (`/qr`), "Estadísticas" (`/estadisticas`), "Plan y pagos" (`/plan`) with one reusable "Próximamente" component.
  - Remove "Volver al inicio" from `/menu` and `/local`; the product editor keeps "← Volver a Mi menú".
  - Per-page `document.title`.
- Out: the QR, statistics, plans and payments features; "Publicar cambios" and publish state; the public menu (and the canvas "Ver mi menú público" link); stats that need missing data ("Pedidos del mes", "Primeros pasos", the "PLAN PRO" upsell card); a bottom tab bar; dark mode; native app; any API change; login, sign-up, forgot/reset password, verify email and onboarding pages (they stay outside the shell, unchanged).

## Spec
Scenarios (Given / When / Then):
1. Given I am logged in with a restaurant on a viewport of 1024px or wider, when I open any shell route, then the sidebar is always visible with "menucito.", my logo (or initials when I have none), my restaurant name and "Plan Básico" (or "Plan Pro"), the six items in canvas order and "Cerrar sesión" at the bottom of the viewport, even on long pages.
2. Given any shell route, when it renders, then exactly one nav item is highlighted and has `aria-current="page"`: `/` -> "Resumen" (exact match only), `/menu` and `/menu/products/new`, `/menu/products/:id` -> "Mi menú", `/local` -> "Mi local", `/qr` -> "Link y QR", `/estadisticas` -> "Estadísticas", `/plan` -> "Plan y pagos".
3. Given I click a nav item, when the page changes, then it renders inside the same shell without a full reload and the shell does not flash a loading state.
4. Given a viewport below 1024px (down to 360px), when I open a shell route, then I see a top bar with my logo/initials, my restaurant name (truncated, never wrapping the bar) and a "☰" button labelled "Abrir menú"; there is no sidebar and no horizontal scroll.
5. Given the mobile top bar, when I tap "☰", then a drawer opens from the left with the same navigation as the desktop sidebar over a dimmed backdrop, focus moves into the drawer, `Tab` stays inside it and the page behind cannot be scrolled or focused.
6. Given the drawer is open, when I press Escape, tap the backdrop or tap the drawer's close button ("Cerrar menú"), then it closes and focus returns to "☰"; when I tap a nav item, then it navigates and the drawer closes (also when tapping the item of the current page).
7. Given the drawer is open, when the viewport grows to 1024px or wider, then the drawer closes and the sidebar shows.
8. Given I click "Cerrar sesión" (sidebar or drawer), then the session ends, the cached session and restaurant are cleared and I land on `/login` (same behavior as today's home button); the home no longer has its own sign-out button.
9. Given I open `/`, then I see "Resumen" with "Hola, <first name>" (just "Hola" when the session has no name), a card with "Tu link" (the public menu URL as text) and "Tu WhatsApp" with the formatted number and "Enviar mensaje de prueba", and two tiles "Productos" ("N de M" on Basic, "N" on Pro, from the catalog `usage`) and "Categorías" (N). No publish state, orders, checklist or upsell, and no invented numbers: while the catalog loads or if it fails, the tiles show "—".
10. Given I open `/qr`, `/estadisticas` or `/plan`, then I see the section title as `h1` ("Link y QR", "Estadísticas", "Plan y pagos") and a "Próximamente" empty state with "Estamos trabajando en esta sección."; no plan check, Basic can open "Estadísticas". The nav keeps the "PRO" pill on "Estadísticas" on every plan.
11. Given `/menu` or `/local`, then there is no "Volver al inicio" link; given the product editor, then "← Volver a Mi menú" stays above its title and "Mi menú" is highlighted in the nav.
12. Given I upload or remove my logo on `/local`, then the shell avatar updates without reloading.
13. Given any page, then `document.title` is "<Sección> · Menucito" (e.g. "Mi menú · Menucito"; the editor uses "Nuevo producto" / "Editar producto"); pages outside the shell keep the current title.
14. Given no session, when I open any shell route, then I go to `/login`; given a session without a restaurant, then I go to `/onboarding` (existing guards); `/login`, `/onboarding`, `/forgot-password`, `/reset-password` and `/verify-email` render without the shell; an unknown path still redirects to `/`.
15. Given a 375px touch viewport and a 1280px desktop, when I use every nav item, the drawer and "Cerrar sesión", then every control is at least 44px, keyboard focus is visible, and the spec 04 behavior of `/menu` (sticky "Nuevo producto" on mobile, category chips) still works under the top bar.

## Design
- Routes (`main.tsx`): `RequireAuth` > `RequireRestaurant` > `AdminShell` (layout route, no path) > `/` (`SummaryPage`), `/menu`, `/menu/products/new`, `/menu/products/:id`, `/local`, `/qr`, `/estadisticas`, `/plan`. Path style follows `/menu` and `/local` (short, lowercase, no accents). Everything else stays as today. Delete `WelcomePage.tsx`.
- Nav config (`lib/nav.ts`, pure, no React): `NAV_ITEMS` in canvas order, each `{ id, label, to, title, pro?: true }` ("Resumen" `/`, "Mi menú" `/menu`, "Mi local" `/local`, "Link y QR" `/qr`, "Estadísticas" `/estadisticas` `pro`, "Plan y pagos" `/plan`); `activeNavItem(pathname)` (`/` matches only exactly; others match the path or a `/`-prefixed sub-path, so `/menu/products/x` is "Mi menú" and `/menuX` is nothing; trailing slash tolerated; unknown -> `null`); `documentTitle(section)` -> "<section> · Menucito". The shell reads `activeNavItem` for `aria-current` and the title, so matching lives in one tested place (do not mix it with `NavLink`'s own matching).
- Components: `components/shell/AdminShell.tsx` (layout + `<Outlet />`, owns the only `<main id="main">`), `NavPanel.tsx` (wordmark, restaurant card, items, "Cerrar sesión"; rendered once in the sidebar and once in the drawer), `MobileTopBar.tsx`, `NavDrawer.tsx`, and `components/ComingSoon.tsx` (`title` prop; `h1` + white card "Próximamente" / "Estamos trabajando en esta sección."), used by the three placeholder routes through a tiny `ComingSoonPage`. Add a `sm` size to `RestaurantAvatar` (36px, `rounded-[10px]`, 14px initials) for the card and the top bar; reuse `ProBadge` for the pill and `planName` for "Plan Básico".
- Layout: below `lg` a sticky 56px top bar (avatar, truncated name, "☰" 44px button); from `lg` (1024px) a 240px sidebar, `sticky top-0 h-screen` with the item list scrolling inside it, so "Cerrar sesión" is always visible at the bottom. Why `lg` and not `md`: at 768px a 240px sidebar leaves ~528px for `/menu`, whose own `md` layout (categories aside + products) would be cramped. Content padding moves from the pages to the shell (`px-4 sm:px-8`, `py-6 sm:py-8`); pages drop their `min-h-screen bg-bg` wrapper and their own `<main>` and keep their max-width containers. `/menu` keeps its bottom padding for the sticky button. Add a "Saltar al contenido" skip link to `#main` (visible on focus). Add only the tokens the canvas needs to `index.css` (e.g. `--color-nav-active: #ffedd5`).
- Mobile: no bottom tab bar. Six items at 360px leave ~60px per tab, too narrow for labels like "Plan y pagos" or "Estadísticas" plus the PRO pill; dropping to icons-only or a "Más" overflow hides sections and differs from the desktop structure. A top bar + drawer reuses the exact same `NavPanel`, keeps the logo and name always visible, and leaves the bottom free for `/menu`'s sticky "Nuevo producto".
- Drawer: native `<dialog>` opened with `showModal()` (no new dependency): the browser makes the rest of the page inert (real focus containment), closes on Escape (`cancel`/`close` events keep React state in sync) and renders `::backdrop`. Close on backdrop click (click target is the dialog itself), on the close button, on any nav item click and when `matchMedia("(min-width: 1024px)")` starts matching. Lock page scroll while open (`overflow: hidden` on `html`). Return focus to "☰" on close (do not rely only on the browser). Slide-in animation optional and disabled under `prefers-reduced-motion`. `aria-label="Panel"` on both `<nav>`s, `aria-expanded`/`aria-controls` on "☰".
- Sign-out: move the mutation from `WelcomePage` into `useSignOut()` in `lib/session.ts` (same steps: `authClient.signOut`, set `SESSION_KEY` to `null`, remove `RESTAURANT_KEY` queries, `navigate("/login", { replace: true })`); "Cerrar sesión" is a button styled like the canvas link, disabled while pending.
- Resumen (`pages/SummaryPage.tsx`): data from `useSession` (first word of `user.name`), `useMyRestaurant` and `useCatalog` (existing `GET /api/categories`; products = `usage.products`, categories = list length, "de M" only when `usage.maxProducts` is not null). Moves `formatWhatsapp`/`whatsappTestUrl` over unchanged. "Mi menú"/"Mi local" shortcut links are dropped (the nav covers them). The public URL is plain text, not a link, until the public menu exists.
- Product editor: stays a sub-page inside the shell (canvas `ProductoEditor.dc.html` keeps "← Volver a Mi menú" and highlights "Mi menú"); `EditorShell` loses its outer wrapper only.
- Document title: implement (cheap, helps tabs and history): a small `useDocumentTitle(title)` hook; the shell sets it from `activeNavItem`, the editor overrides it with "Nuevo producto"/"Editar producto". Restore nothing on unmount; pages outside the shell are unchanged.

## Tasks
- [x] 1. `lib/nav.ts` (`NAV_ITEMS`, `activeNavItem`, `documentTitle`) + `lib/nav.test.ts` (Vitest): every route in scenario 2, `/` exact-only, segment boundary (`/menuX`), trailing slash, unknown path, item order and the `pro` flag only on "Estadísticas".
- [x] 2. `useSignOut` in `lib/session.ts`, `useDocumentTitle`, `RestaurantAvatar` `sm` size, nav tokens in `index.css`.
- [x] 3. Shell: `AdminShell`, `NavPanel`, `MobileTopBar`, `NavDrawer` (native `<dialog>`), skip link.
- [x] 4. Routes in `main.tsx`; `SummaryPage` replacing `WelcomePage`; `ComingSoon` + `/qr`, `/estadisticas`, `/plan`.
- [x] 5. Move `MenuPage`, `ProductEditorPage`, `LocalPage` into the shell: remove "Volver al inicio", outer wrappers and nested `<main>`; keep the editor back link and `/menu`'s sticky button.
- [ ] 6. Manual browser run of scenarios 1-15 at 375px (mobile emulation, touch, keyboard in the drawer) and at 1280px, with and without a logo, on Basic and Pro (switch `plan` in the local D1 only); update `README.md` (admin routes and shell); stop any servers you started.

## Verify
- [ ] Scenarios 1..15 pass (`lib/nav.ts` with Vitest, the rest manually in a browser at 375px and 1280px)
- [ ] No "Volver al inicio" left in the admin; exactly one `<main>` per shell page; no horizontal scroll from 360px
- [ ] Drawer: focus contained, Escape/backdrop/close/nav-click close it, focus returns to "☰"
- [x] No API, `packages/shared` or vault change; the shell uses only `useMyRestaurant`, `useSession` and `useCatalog`
- [x] Lint, types, tests and build pass (`pnpm turbo lint typecheck test build`)
- [x] `README.md` updated
