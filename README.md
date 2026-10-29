# Menucito

Monorepo (pnpm + Turborepo):

- `apps/api` - Hono on Cloudflare Workers, Better Auth, Drizzle, D1 (SQLite), Zod.
- `apps/admin` - React + Vite + TypeScript, Tailwind, shadcn/ui-style components, TanStack Query, React Hook Form, react-router.
- `packages/shared` - Zod schemas and pure helpers shared by both apps (auth forms, restaurant: slug rules, Argentine WhatsApp normalization).

Docs and specs: `docs/changes/` (current change: `02-restaurant-onboarding.md`). `Menucito/` is the Obsidian vault.

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

Two terminals:

```bash
pnpm --filter @menucito/api dev      # API on http://localhost:8787 (wrangler dev --local)
pnpm --filter @menucito/admin dev    # Admin on http://localhost:5173
```

Open http://localhost:5173.

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
pnpm test      # Vitest: shared helpers, and the API in the Workers runtime against an in-memory D1
# or everything: pnpm turbo lint typecheck build test
```

## API

Own endpoints follow a layered architecture in `apps/api/src`: `routes/` (Hono, Zod validation, JSON) -> `services/` (business rules, domain errors) -> `repositories/` (Drizzle/D1), plus `middleware/require-session.ts`. The tenant (owner) always comes from the session, never from the request body. Errors use the body `{"error": {"code", "message"}}`.

| Method and path | Response |
| --- | --- |
| `GET /api/restaurants/me` | 200 restaurant, 404 `RESTAURANT_NOT_FOUND` if the user has none |
| `GET /api/restaurants/slug-available?slug=` | 200 `{available, reason?: "invalid" | "reserved" | "taken"}` |
| `POST /api/restaurants` | body `{name, slug, whatsapp, delivery, takeaway}`; 201 restaurant, 409 `SLUG_TAKEN` / `ALREADY_HAS_RESTAURANT`, 422 `VALIDATION_ERROR` |

All `/api/restaurants/*` endpoints answer 401 `UNAUTHORIZED` without a session. WhatsApp numbers are stored normalized as `549` + area code + number (digits only).

After pulling schema changes, apply new migrations locally: `pnpm --filter @menucito/api db:migrate:local`.

### Admin environment

| Variable | Purpose |
| --- | --- |
| `VITE_PUBLIC_BASE` | Host shown in the public menu link (`<host>/<slug>`). Default `menucito.com` (placeholder) |

## Environment variables (`apps/api/.dev.vars`)

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signing/encryption secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Public origin of the app. Local: `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (guide below) |
| `RESEND_API_KEY` | Resend API key. Empty = log emails to the console |
| `EMAIL_FROM` | Sender address. Local/no domain: `onboarding@resend.dev` |

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
