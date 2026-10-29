# 01 · Auth: email/password, Google, password reset and welcome view

Status: done (closed 2026-10-28; Resend domain pending, see Verify)
Date: 2026-10-28

## Intent
Bootstrap the monorepo (`api` + `admin` + `shared`) and ship the full auth base: email/password, Google login, working transactional emails (verification + password reset), ending in a "Bienvenido <name>" view with log out.

## Scope
- In: pnpm + Turborepo monorepo; `apps/api` (Hono on Workers, Better Auth, D1, Drizzle, Resend); `apps/admin` (React + Vite + TS, Tailwind, shadcn/ui, TanStack Query, React Hook Form + Zod); `packages/shared` (Zod schemas); pages: login/sign up (tabs), forgot password, reset password, verify-email notice, welcome; log out; route protection; Google OAuth.
- Out: `apps/web` (Astro), restaurant creation / onboarding, `restaurant_id` and multi-tenant tables, KV, R2, payments, CI/CD, production deploy and custom domains, dashboard screens other than the welcome view.
- UI follows `.design-canvas/project/Login.dc.html` (tokens: bg `#F7F5F2`, ink `#1C1917`, primary `#C2410C`, link `#9A3412`, accent `#FB923C`, border `#E7E2DC`; fonts Bricolage Grotesque + DM Sans; Spanish copy as in the canvas). Forgot/reset/verify screens reuse the same split layout since the canvas has none.

## Spec
Scenarios (Given / When / Then):
1. Given no account, when I sign up with name + email + password (min 8) on the "Crear cuenta" tab, then the account is created, a verification email is sent, and I see a "revisá tu email" notice.
2. Given an unverified account, when I try to log in, then I am blocked with a "verify your email" message and can resend the email.
3. Given the verification link in the email, when I open it, then the email is verified, I am logged in and land on `/` showing "Bienvenido <name>".
4. Given a verified account, when I log in with valid credentials, then I land on `/` showing "Bienvenido <name>".
5. Given wrong credentials, when I submit, then I stay on the page and see an error.
6. Given an email already registered, when I sign up with it, then I see an "email already in use" error.
7. Given I click "Continuar con Google", when I complete Google consent, then I am logged in (account created if new) and land on `/` showing "Bienvenido <name>".
8. Given "Olvidé mi contraseña", when I submit my email, then I always see a neutral "si existe, te enviamos un email" message and, if the account exists, a reset email is sent.
9. Given a valid reset link, when I set a new password (min 8), then it is updated, old sessions are revoked, and I can log in with the new one.
10. Given an expired or invalid reset link, when I open it, then I see an error and a way to request a new one.
11. Given I am logged in, when I click "Cerrar sesión", then the session ends and I go to `/login`.
12. Given no session, when I open `/`, then I am redirected to `/login`; given a session, reload keeps me in.
13. Given invalid input (bad email, short password), when I submit, then Zod errors show client-side and no request is sent.

## Design
- Layout as in `03-arquitectura/Stack-tecnologico.md`: `apps/api`, `apps/admin`, `packages/shared`.
- API: Hono mounts Better Auth at `/api/auth/*`: emailAndPassword (requireEmailVerification, sendResetPassword), emailVerification (sendOnSignUp, autoSignInAfterVerification), Google social provider; Drizzle adapter over D1 (`user`, `session`, `account`, `verification`).
- Emails: Resend via `fetch` from a `sendEmail` helper. If `RESEND_API_KEY` is missing (local dev), the email is logged to the console with its link, so everything is testable without keys.
- Local dev: `wrangler dev` with local D1. Admin Vite proxies `/api` to `:8787`, so the browser origin is `http://localhost:5173` and cookies are same-origin. `BETTER_AUTH_URL=http://localhost:5173`; Google redirect URI: `http://localhost:5173/api/auth/callback/google`.
- Secrets in `apps/api/.dev.vars` (gitignored): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. Commit a `.dev.vars.example`.
- Prod note (later): `app.` and `api.` subdomains need cross-subdomain cookies; Resend needs a verified domain.

## Tasks
- [x] 1. Monorepo scaffold: pnpm workspace, Turborepo, base tsconfig, `packages/shared` (Zod schemas).
- [x] 2. `apps/api`: Hono + Wrangler, D1 binding, Drizzle schema + migration (local), `/health`.
- [x] 3. Better Auth config: email/password, verification, reset, Google, `sendEmail` helper (Resend + console fallback).
- [x] 4. `apps/admin`: Vite + React + TS + Tailwind + shadcn/ui, proxy, Better Auth client, design tokens/fonts.
- [x] 5. Pages: login/sign up tabs (per canvas), forgot, reset, verify notice; Zod + RHF.
- [x] 6. Welcome view, log out, route guard.
- [x] 7. Vitest for the API (sign up, login, verify, reset) + manual run of scenarios 1..13; README with setup.

## Verify
- [ ] Scenarios 1..13 pass (API ones with Vitest, UI and Google manually). Google login confirmed working manually (2026-10-28); real Resend sending still to test.
- [ ] PENDING: Resend with a verified domain (until then it only sends to the account owner from `onboarding@resend.dev`). Domain will be bought after development is finished; until then Resend only delivers to the account owner (`estybvb@gmail.com`) and testing must use that email.
- [x] Lint, types and build pass (`pnpm turbo lint typecheck build`)
- [x] README with setup/run steps written
