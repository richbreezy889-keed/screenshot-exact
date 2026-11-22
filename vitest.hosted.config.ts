import { defineConfig } from "vitest/config"

// Hosted-mode tests run against a real Supabase project through the actual API.
// Requires .env.test.local with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["supabase/tests-hosted/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
})