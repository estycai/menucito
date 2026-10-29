# Menucito

Monorepo (pnpm + Turborepo):

- `apps/api` - Hono on Cloudflare Workers, Better Auth, Drizzle, D1 (SQLite), R2 (media), Zod.
- `apps/admin` - React + Vite + TypeScript, Tailwind, shadcn/ui-style components, TanStack Query, React Hook Form, react-router.
- `packages/shared` - Zod schemas and pure helpers shared by both apps (auth forms, restaurant: slug rules, Argentine WhatsApp normalization, media limits, catalog schemas, ARS price parsing/formatting, plan limits).

Docs and specs: `docs/changes/` (current change: `04-menu-catalog.md`). `Menucito/` is the Obsidian vault.

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
pnpm test      # Vitest: shared helpers, admin image helpers, and the API in the Workers runtime (in-memory D1 and R2)
# or everything: pnpm turbo lint typecheck build test
```

## API

Own endpoints follow a layered architecture in `apps/api/src`: `routes/` (Hono, Zod validation, JSON) -> `services/` (business rules, domain errors) -> `repositories/` (Drizzle/D1), plus `storage/` (R2, used only by services) and `middleware/require-session.ts`. The tenant (owner) always comes from the session, never from the request body. Errors use the body `{"error": {"code", "message"}}`.

| Method and path | Response |
| --- | --- |
| `GET /api/restaurants/me` | 200 restaurant, 404 `RESTAURANT_NOT_FOUND` if the user has none |
| `GET /api/restaurants/slug-available?slug=` | 200 `{available, reason?: "invalid" | "reserved" | "taken"}` |
| `POST /api/restaurants` | body `{name, slug, whatsapp, delivery, takeaway}`; 201 restaurant, 409 `SLUG_TAKEN` / `ALREADY_HAS_RESTAURANT`, 422 `VALIDATION_ERROR` |
| `PUT /api/restaurants/me/logo` | multipart/form-data, field `file` (WebP, max 1 MB); 200 `{logoUrl}`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 404 `RESTAURANT_NOT_FOUND` |
| `DELETE /api/restaurants/me/logo` | 204 (also when there is no logo) |
| `PUT /api/restaurants/me/plan` | body `{plan: "basic" \| "pro"}`; 200 restaurant (the current plan is a no-op), 403 `PLAN_SWITCH_DISABLED` unless `ALLOW_PLAN_SWITCH=true`, 404 `RESTAURANT_NOT_FOUND`, 422 `VALIDATION_ERROR`. Free test switch, see "Plan switch" |
| `GET /api/media/*` | Public, no session. Serves `logos/...` and `products/...` keys only. 200 `image/webp` with `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`; 404 `NOT_FOUND` |
| `GET /api/categories` | 200 `{categories: [{id, name, position, products: [Product]}], usage: {products, maxProducts, productPhotos}}` (both lists ordered by `position`) |
| `POST /api/categories` | body `{name}` (trimmed, 1-40); 201 category, 409 `CATEGORY_NAME_TAKEN` (case-insensitive), 422 |
| `PATCH /api/categories/:id` | body `{name}`; 200 category, 404 `CATEGORY_NOT_FOUND`, 409 `CATEGORY_NAME_TAKEN`, 422 |
| `DELETE /api/categories/:id` | 204, 404, 409 `CATEGORY_NOT_EMPTY` (a category with products is never deleted) |
| `PUT /api/categories/order` | body `{ids}` with every category id exactly once; 204, 422 otherwise |
| `PUT /api/categories/:id/products/order` | body `{ids}` with every product id of the category exactly once; 204, 404, 422 |
| `POST /api/products` | body `{categoryId, name, description?, priceCents, available?}`; 201 product, 403 `PLAN_LIMIT`, 404 `CATEGORY_NOT_FOUND`, 422 |
| `GET /api/products/:id` | 200 product, 404 `PRODUCT_NOT_FOUND` |
| `PATCH /api/products/:id` | any subset of the create fields; a new `categoryId` moves it to the end of that category; 200, 404, 422 |
| `DELETE /api/products/:id` | 204 (also deletes its photo), 404 |
| `PUT /api/products/:id/photo` | multipart/form-data, field `file` (WebP, max 1 MB); 200 `{imageUrl}`, 403 `PLAN_LIMIT`, 404, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE` |
| `DELETE /api/products/:id/photo` | 204 (also when there is no photo), 404 |

Product: `{id, categoryId, name, description, priceCents, imageUrl, available, position, createdAt, updatedAt}`. Prices are integer ARS cents (`900000` = `$9.000`); `available: false` means "Agotado".

All `/api/restaurants/*`, `/api/categories/*` and `/api/products/*` endpoints answer 401 `UNAUTHORIZED` without a session, and 404 `RESTAURANT_NOT_FOUND` when the user has no restaurant. The tenant is the session's restaurant: an id that belongs to another restaurant answers 404, never 403. WhatsApp numbers are stored normalized as `549` + area code + number (digits only).

### Logo and media (R2)

- The restaurant logo is available on every plan (no plan check). The admin (`/local`, "Mi local") normalizes any PNG, JPG, WebP, GIF or SVG in the browser to a 512x512 WebP ("contain", transparent padding) and uploads only that WebP; SVGs are rasterized through an `<img>`, so their scripts never run and the SVG itself is never uploaded.
- The Worker validates size (<= 1 MB), `Content-Type: image/webp` and the `RIFF....WEBP` signature, writes `logos/<restaurantId>/<random>.webp` to the `MEDIA` bucket (`menucito-media`), stores the public path in `restaurants.logo_url`, then deletes the previous object (a failed delete is only logged).
- Local: `wrangler dev --local` emulates R2 with Miniflare (data in `apps/api/.wrangler`); no bucket or Cloudflare account is needed. Tests use the Workers-runtime R2 binding.
- Uploads go through the Worker on purpose (no presigned URLs): presigned R2 URLs need S3 API credentials and do not work with the local emulator. Product photos use the same path (an 800x800 WebP is ~50-150 KB).
- Product photos (admin `/menu`): one photo per product, normalized in the browser to an 800x800 WebP ("cover": scaled to fill and center-cropped). Accepted sources: PNG, JPG, WebP, GIF (no SVG). The file input uses `accept="image/*"` without `capture`, so phones offer both camera and gallery. Stored as `products/<restaurantId>/<random>.webp`, same validation and replace order as the logo; deleting a product deletes its photo.

### Plan limits

Plan limits live only in `packages/shared/src/plans.ts` (`PLAN_LIMITS`, `planLimitsFor`); unknown plans get Basic. Basic: up to 40 products, product photos included. Pro: unlimited products. One photo per product on every plan; no category limit. Only creating products is limited (403 `PLAN_LIMIT`): a restaurant above the limit keeps, edits, moves and deletes its products.

### Plan switch (testing aid)

Until Mercado Pago exists there is no way to pay, so `/plan` ("Plan y pagos") can switch the restaurant between Basic and Pro for free. This lets the plan limits and Pro behavior be tested end to end; it is not a product feature and the future checkout and webhook will replace it. It is guarded by two flags, both off by default:

- `ALLOW_PLAN_SWITCH=true` (API, `apps/api/.dev.vars`): the real guard. Without it `PUT /api/restaurants/me/plan` answers 403 `PLAN_SWITCH_DISABLED` and never changes a plan. It is deliberately absent from `wrangler.jsonc`, so no deployed environment has it unless someone adds it on purpose.
- `VITE_PLAN_SWITCH=true` (admin, build time): only shows or hides the switch button on `/plan`. Without it the page shows the plans and "El pago de planes estará disponible pronto."

Set both together locally; keep both unset in staging and production. Downgrading never deletes or hides products: a restaurant above the Basic limit keeps them all and only new products are blocked (403 `PLAN_LIMIT`).

After pulling schema changes, apply new migrations locally: `pnpm --filter @menucito/api db:migrate:local`.

### Admin panel routes and shell

Every admin page with a restaurant lives inside `AdminShell` (`apps/admin/src/components/shell`), a layout route under `RequireAuth` and `RequireRestaurant`: a 240px sidebar from 1024px, and a top bar with a drawer (native modal `<dialog>`) below it. Both render the same `NavPanel` (restaurant logo or initials, name, plan, sections and "Cerrar sesión"). Navigation items and route matching live in `apps/admin/src/lib/nav.ts`.

| Route | Section |
| --- | --- |
| `/` | Resumen (public link, WhatsApp, product and category counts) |
| `/menu`, `/menu/products/new`, `/menu/products/:id` | Mi menú |
| `/local` | Mi local |
| `/plan` | Plan y pagos (current plan, the two plans, optional test switch) |
| `/qr`, `/estadisticas` | Link y QR, Estadísticas: "Próximamente" placeholders |

Login, sign-up, forgot/reset password, verify email and onboarding render outside the shell. `document.title` is "<Sección> · Menucito".

### Admin environment

| Variable | Purpose |
| --- | --- |
| `VITE_PUBLIC_BASE` | Host shown in the public menu link (`<host>/<slug>`). Default `menucito.com` (placeholder) |
| `VITE_PLAN_SWITCH` | `true` shows the free plan switch on `/plan` (UI only; the API flag `ALLOW_PLAN_SWITCH` is the real guard). Default off |

## Environment variables (`apps/api/.dev.vars`)

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signing/encryption secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Public origin of the app. Local: `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (guide below) |
| `RESEND_API_KEY` | Resend API key. Empty = log emails to the console |
| `EMAIL_FROM` | Sender address. Local/no domain: `onboarding@resend.dev` |
| `ALLOW_PLAN_SWITCH` | `true` enables the free plan switch endpoint. Local testing only; never set it in a deployed environment |

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
