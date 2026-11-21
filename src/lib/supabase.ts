import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

let cachedClient: ReturnType<typeof createClient<Database>> | null = null

/**
 * Lazily creates and caches the Supabase client. Never runs at module load,
 * so server-side rendering is unaffected. Browser use only.
 */
export function getSupabase() {
  if (cachedClient) return cachedClient
  const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined
  const key = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined
  if (!url || !key) {
    throw new Error(
      "Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    )
  }
  cachedClient = createClient<Database>(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return cachedClient
}

/** True when the app is configured to use the real Supabase backend. */
export function isSupabaseMode() {
  return import.meta.env["VITE_DATA_SOURCE"] === "supabase"
}