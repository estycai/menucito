# 06 · Plan and payments screen with a test plan switch

Status: done
Date: 2026-10-28
Depends on: `docs/changes/05-admin-shell.md` (must be done first)

## Intent
Replace the "Próximamente" placeholder at `/plan` with a real "Plan y pagos" screen that shows the two plans and lets the owner switch between them for free, as a testing aid until Mercado Pago exists. Switching is guarded on the server by an environment flag that is off by default, so it can never ship enabled by accident. Payments stay out: this screen is the place where the Mercado Pago checkout will replace the switch later.

## Context for the implementer (read first, you have no prior conversation)
- Monorepo at the project root (pnpm + Turborepo): `apps/api` (Hono on Cloudflare Workers, Better Auth, Drizzle, D1, R2), `apps/admin` (React + Vite + TS + Tailwind v4 + shadcn-style components + TanStack Query + react-router), `packages/shared` (`@menucito/shared`). Specs 01-05 are done: read them in `docs/changes/` and `README.md`.
- API architecture is MANDATORY layered: routes -> services -> repositories (see `Menucito/03-arquitectura/Arquitectura-del-backend.md`). Follow `apps/api/src/routes/restaurants.ts`, `services/restaurants.ts` and `repositories/restaurants.ts`. Domain errors are mapped to HTTP in `routes/http.ts` (`STATUS_BY_CODE`).
- Plan facts live in `packages/shared/src/plans.ts` (`PlanId`, `PLAN_LIMITS`, `planLimitsFor`); the plan is stored in `restaurants.plan` and reaches the admin through `useMyRestaurant` (`lib/restaurant.ts`), display names through `lib/plans.ts`. Plan limits only block creation: existing products are never deleted or hidden.
- Reuse: `components/ProBadge.tsx`, `components/ComingSoon.tsx` (to be replaced for `/plan` only), `components/ui/*`, `useMyRestaurant` and `RESTAURANT_KEY` (invalidate after the switch so the shell and every page update at once).
- UI copy in Spanish; code, identifiers and comments in English. No prices: they are an open product decision, do not invent them.
- Local only. Never print or commit `apps/api/.dev.vars`; never read `data_sensible/`. Do not commit or push. Do not leave dev servers running when finished.

## Scope
- In:
  - `PUT /api/restaurants/me/plan` with body `{ "plan": "basic" | "pro" }`, guarded by the `ALLOW_PLAN_SWITCH` flag.
  - `changePlanSchema` in `packages/shared` and a `PLAN_SWITCH_DISABLED` domain error.
  - `/plan` page "Plan y pagos": current plan, the two plans side by side with what each includes (from `PLAN_LIMITS`), and the test switch.
  - Admin build flag `VITE_PLAN_SWITCH` that shows or hides the switch; the API flag is the real guard.
  - README and `.dev.vars.example` updates.
- Out: Mercado Pago, prices, invoices, billing history, trial periods, downgrade side effects (no product is removed or hidden), the "PLAN PRO" upsell card on Resumen, plan checks on other sections (Estadísticas stays open to Basic), customizable ingredients and any other Pro feature.

## Spec
Scenarios (Given / When / Then):
1. Given `ALLOW_PLAN_SWITCH` is not `"true"` on the API, when `PUT /api/restaurants/me/plan` is called with a valid body, then it answers 403 `PLAN_SWITCH_DISABLED` and the plan does not change.
2. Given the flag is `"true"` and I am logged in with a restaurant, when I send `{ "plan": "pro" }`, then the restaurant plan becomes `pro` and the response is the updated restaurant; sending `basic` switches back; sending the current plan is a no-op that still answers 200.
3. Given no session, then the endpoint answers 401; given a session without a restaurant, 404 `RESTAURANT_NOT_FOUND`; given a body with an unknown plan (e.g. `"enterprise"`) or no body, 422 `VALIDATION_ERROR`.
4. Given I open `/plan`, then I see the `h1` "Plan y pagos", a line "Tu plan actual: Plan Básico" (or "Plan Pro") and two plan cards, "Básico" and "Pro". The card of my current plan is marked "Plan actual".
5. Given the plan cards, then Básico lists "Hasta 40 productos" and Pro lists "Productos ilimitados", both taken from `PLAN_LIMITS` (no hard-coded numbers in the page), and Pro shows the "PRO" badge. No prices are shown.
6. Given the build flag `VITE_PLAN_SWITCH=true`, when I open `/plan`, then the card of the other plan has a button "Cambiar a Plan Pro" (or "Cambiar a Plan Básico") under a notice "Modo de prueba: el cambio de plan es gratuito y no se cobra nada."; without the flag there is no button and no notice, and the page says "El pago de planes estará disponible pronto."
7. Given I click the switch button, when the request succeeds, then the button shows a pending state while it runs, the shell and the page show the new plan without reloading (sidebar "Plan Pro"), and focus stays on the page (no full reload).
8. Given the switch request fails (e.g. 403 because the API flag is off), then I see an error notice "No pudimos cambiar el plan. Probá de nuevo." and the plan shown does not change.
9. Given I switch from Pro to Basic while having more than 40 products, then nothing is deleted or hidden, the Mi menú usage line reads "N de 40 productos en el plan Básico" with N above 40, and creating a new product is blocked by the existing `PLAN_LIMIT` rule.
10. Given a 375px touch viewport and a 1280px desktop, then the cards stack on mobile and sit side by side from `lg`, there is no horizontal scroll from 360px, every control is at least 44px and keyboard focus is visible.
11. Given any page, then `document.title` on `/plan` is "Plan y pagos · Menucito" (unchanged from spec 05).

## Design
- API: `ALLOW_PLAN_SWITCH?: string` in `Env` (`env.ts`), absent from `wrangler.jsonc` so it is off in every deployed environment by default; `.dev.vars.example` documents `ALLOW_PLAN_SWITCH=true` for local development. The flag is read in the route (it is configuration, not business logic) and passed to the service as a boolean. When it is off the service throws `PlanSwitchDisabledError` (`code: "PLAN_SWITCH_DISABLED"`, mapped to 403 in `STATUS_BY_CODE`).
- Route: `.put("/me/plan", ...)` in `routes/restaurants.ts`, behind the existing `requireSession`, parsed with `parseJsonBody(c, changePlanSchema)`. Service `restaurantsService.changePlan(userId, plan, { enabled })` resolves the user's restaurant (404 if none), updates `plan` through the repository and returns the same restaurant shape as `GET /me`.
- Shared: `changePlanSchema = z.object({ plan: z.enum(["basic", "pro"]) })` next to the other restaurant schemas, derived from `PlanId` so a new plan cannot be forgotten.
- Admin: `lib/plan.ts` with `useChangePlan()` (mutation, on success `setQueryData`/invalidate `RESTAURANT_KEY`); `pages/PlanPage.tsx` replaces the `/plan` route's `ComingSoonPage` in `main.tsx` (keep `ComingSoonPage` for `/qr` and `/estadisticas`); `components/PlanCard.tsx` for one card. `VITE_PLAN_SWITCH` is read once in a small `lib/config.ts` next to `VITE_PUBLIC_BASE` (follow how that one is read today).
- Why two flags: the Vite flag only hides UI and is baked at build time; the API flag is the actual protection. Both default to off. Documenting both in the README keeps staging and production from drifting.
- Why the plan is replaced by Mercado Pago later, not extended: the future change swaps this endpoint for a checkout and a webhook; the screen layout (current plan + two cards) stays.

## Tasks
- [x] 1. `packages/shared`: `changePlanSchema` + export, with a Vitest test (valid values, unknown plan, missing field).
- [x] 2. API: `ALLOW_PLAN_SWITCH` in `env.ts`, `PlanSwitchDisabledError`, `STATUS_BY_CODE` entry, repository `updatePlan`, service `changePlan`, route `PUT /me/plan`; API tests for scenarios 1-3 and 9 (flag off, flag on, switch back, no-op, no session, no restaurant, invalid body, downgrade keeps products).
- [x] 3. Admin: `lib/config.ts` flag, `useChangePlan`, `PlanCard`, `PlanPage`, route swap in `main.tsx`.
- [x] 4. Docs: `.dev.vars.example`, `README.md` (endpoint table, both flags, what the switch is for); do not print `.dev.vars`.
- [x] 5. Manual browser run of scenarios 4-11 at 375px and 1280px with the flags on and off, switching Basic -> Pro -> Basic, including a Basic account with more than 40 products; stop any servers you started.

## Verify
- [x] Scenarios 1..11 pass (1-3 and 9 with API tests, the rest manually in a browser)
- [x] With the flag off the endpoint never changes a plan and the page shows no switch
- [x] No other section checks the plan (Estadísticas open to Basic)
- [x] No prices, no Mercado Pago code, no product deleted or hidden on downgrade
- [x] Lint, types, tests and build pass (`pnpm turbo lint typecheck test build`)
- [x] `README.md` and `.dev.vars.example` updated
