export interface Env {
  DB: D1Database;
  /** R2 bucket `menucito-media` (logos). Emulated by Miniflare under `wrangler dev --local`. */
  MEDIA: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /**
   * `"true"` enables `PUT /api/restaurants/me/plan` (free plan switch, a testing aid until payments exist).
   * Never set in `wrangler.jsonc`: it is off in every deployed environment unless added on purpose.
   */
  ALLOW_PLAN_SWITCH?: string;
}

/** Hono environment shared by the app and its routers. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Authenticated user id, set by `requireSession`. */
    userId: string;
  };
}
