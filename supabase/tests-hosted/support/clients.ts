import { createClient, SupabaseClient, User } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./env"

export function createAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type TestUser = {
  email: string
  password: string
  role: "creator" | "brand" | "admin" | "outsider"
}

export async function getUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getUser()
  return data?.user?.id ?? null
}

export async function createUserViaAdmin(
  serviceClient: SupabaseClient,
  user: TestUser
): Promise<{ id: string; error: unknown }> {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { role: user.role },
  })
  return { id: data?.user?.id ?? "", error }
}

export async function signInUser(
  anonClient: SupabaseClient,
  email: string,
  password: string
): Promise<SupabaseClient> {
  const { error } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  return anonClient
}