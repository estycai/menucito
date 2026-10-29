export interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** Hono environment shared by the app and its routers. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Authenticated user id, set by `requireSession`. */
    userId: string;
  };
}
