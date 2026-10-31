declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** Scratch database used to run migrations step by step (see `migrations.test.ts`). */
    MIGRATION_DB: D1Database;
    MEDIA: R2Bucket;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
