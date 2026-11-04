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
  /**
   * Server key for Places API (New) and Geocoding v3. Without it the address search answers 503
   * `MAPS_UNAVAILABLE`. Keep it restricted to those APIs (never the browser key).
   */
  GOOGLE_MAPS_SERVER_KEY?: string;
  /** Comma-separated list of allowed origins for public CORS. */
  WEB_ORIGINS?: string;
}

/** Hono environment shared by the app and its routers. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Authenticated user id, set by `requireSession`. */
    userId: string;
  };
}
