import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2026-10-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB", "MIGRATION_DB"],
          r2Buckets: ["MEDIA"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
            BETTER_AUTH_URL: "http://localhost:5173",
          },
        },
      }),
    ],
    test: {
      // Password hashing (scrypt) is slow under parallel workers, and the access tests sign in many accounts.
      testTimeout: 30_000,
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
