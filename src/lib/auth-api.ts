import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"
import type { TKey } from "./i18n"

export type SignUpRole = "brand" | "creator"
export type ProfileRole = "admin" | "brand" | "creator"
export type SignUpResult = { kind: "signed-in" } | { kind: "needs-confirmation" }

type Client = SupabaseClient<Database>

/** An auth failure carrying an i18n key. Screens translate the key. */
export class AuthFailure extends Error {
  key: TKey
  constructor(key: TKey) {
    super(key)
    this.name = "AuthFailure"
    this.key = key
  }
}

export function mapAuthError(error: unknown): TKey {
  const e = error as {
    message?: string
    code?: string
    name?: string
    status?: number
  } | null
  const code = (e?.code ?? "").toLowerCase()
  const msg = (e?.message ?? "").toLowerCase()

  if (code === "email_not_confirmed" || msg.includes("email not confirmed"))
    return "auth.emailNotConfirmed"
  if (code === "invalid_credentials" || msg.includes("invalid login"))
    return "auth.invalidCredentials"
  if (
    code === "weak_password" ||
    msg.includes("password should") ||
    msg.includes("weak password")
  )
    return "auth.weakPassword"
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    msg.includes("already registered")
  )
    return "auth.emailAlreadyRegistered"
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    e?.status === 429 ||
    msg.includes("rate limit")
  )
    return "auth.rateLimited"
  if (
    e?.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  )
    return "auth.networkFailure"
  return "auth.unknown"
}

export async function signUpWith(
  sb: Client,
  email: string,
  password: string,
  fullName: string,
  role: SignUpRole,
): Promise<SignUpResult> {
  if (role !== "brand" && role !== "creator") {
    throw new AuthFailure("auth.cannotSelfRegisterAdmin")
  }
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role } },
  })
  if (error) throw new AuthFailure(mapAuthError(error))
  return { kind: data.session ? "signed-in" : "needs-confirmation" }
}

export async function signInWith(
  sb: Client,
  email: string,
  password: string,
): Promise<void> {
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new AuthFailure(mapAuthError(error))
}

/** Role comes from the profiles table, never from user_metadata. */
export async function fetchRoleWith(
  sb: Client,
  uid: string,
): Promise<ProfileRole | null> {
  const { data, error } = await sb
    .from("profiles")
    .select("role")
    .eq("id", uid)
    .maybeSingle()
  if (error || !data) return null
  const r = data.role
  return r === "admin" || r === "brand" || r === "creator" ? r : null
}