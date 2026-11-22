import { defineConfig } from "vitest/config";

// Database tests run against an in-process Postgres (PGlite) with the
// Supabase auth/roles shim from scripts/db/shim.sql.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["supabase/tests/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
