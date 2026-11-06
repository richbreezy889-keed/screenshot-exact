/// <reference types="node" />
// Environment loader for hosted-mode tests.
// Loads .env.test.local and validates that we are NOT targeting production.
import { readFileSync } from "node:fs"

function loadEnvFile(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, "utf8")
    const env: Record<string, string> = {}
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
    return env
  } catch {
    return {}
  }
}

const env = loadEnvFile(new URL(".env.test.local", import.meta.url).pathname)

export const SUPABASE_URL = env["SUPABASE_URL"]
export const SUPABASE_ANON_KEY = env["SUPABASE_ANON_KEY"]
export const SUPABASE_SERVICE_ROLE_KEY = env["SUPABASE_SERVICE_ROLE_KEY"]

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing required environment variables in .env.test.local. " +
    "Create it with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY."
  )
}

// Never run against production.
if (SUPABASE_URL.includes("dxqsawbhyhvxzicdjgdl")) {
  throw new Error("Refusing to run hosted tests against production project")
}