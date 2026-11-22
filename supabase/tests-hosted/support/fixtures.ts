import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./env"

export interface TestUser {
  client: SupabaseClient
  id: string
  email: string
  role: string
}

export interface CampaignOpts {
  title?: string
  platforms?: string[]
  rate_per_1k?: number
  budget?: number
  creators_needed?: number
  videos_per_creator?: number
  deadline?: string
}

const PASSWORD = "HostedTest123!"

export async function ensureUser(
  serviceClient: SupabaseClient,
  email: string,
  role: "creator" | "brand" | "admin" | "outsider",
): Promise<TestUser> {
  // Idempotent: try create via admin API; if already exists, reuse it
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { role, full_name: email },
  })

  let userId: string

  if (createResult.error) {
    // User already exists — sign in to recover the id
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    })
    if (signInErr) throw signInErr
    const { data: userData } = await anonClient.auth.getUser()
    userId = userData!.user!.id
  } else {
    userId = createResult.data!.user!.id
  }

  // Create a dedicated client with a real JWT session for this user
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: clientErr } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  })
  if (clientErr) throw clientErr

  return { client, id: userId, email, role }
}

export async function createBrand(
  brandClient: SupabaseClient,
  name: string,
): Promise<string> {
  const { data, error } = await brandClient.rpc("create_brand", { brand_name: name })
  if (error) throw error

  // Handle data being an object or a one-element array; never use profile id
  if (Array.isArray(data)) {
    return String(data[0]?.id ?? data[0])
  }
  return String(data?.id ?? data)
}

export async function ensureCreatorRow(
  creatorClient: SupabaseClient,
): Promise<void> {
  const { data: userData } = await creatorClient.auth.getUser()
  const id = userData!.user!.id

  const { data: profile } = await creatorClient
    .from("profiles")
    .select("full_name, email")
    .eq("id", id)
    .single()

  const fullName = profile?.full_name ?? `user-${id.slice(0, 8)}`
  const email = profile?.email ?? `${id}@example.test`
  const handle = `@${email.split("@")[0]}`

  // Insert creator row, ignoring duplicate (code 23505)
  const { error } = await creatorClient.from("creators").insert({
    id,
    display_name: fullName,
    handle,
  })
  if (error) {
    if (error.code !== "23505") {
      throw error
    }
  }
}

export async function createLiveCampaign(
  brandClient: SupabaseClient,
  serviceClient: SupabaseClient,
  brandId: string,
  opts: CampaignOpts = {},
): Promise<{ id: string }> {
  // Insert as draft through the brand client
  const { data: campaign, error: camErr } = await brandClient
    .from("campaigns")
    .insert({
      title: opts.title ?? `hosted-test-${Date.now()}`,
      brand_id: brandId,
      status: "draft",
      platforms: opts.platforms ?? ["tiktok"],
      rate_per_1k: opts.rate_per_1k ?? 4000,
      budget: opts.budget ?? 1000000,
      creators_needed: opts.creators_needed ?? 1,
      videos_per_creator: opts.videos_per_creator ?? 1,
      deadline: opts.deadline ?? "2026-12-31",
    })
    .select()
    .single()
  if (camErr) throw camErr

  // Publish through the service client
  const { error: pubErr } = await serviceClient
    .from("campaigns")
    .update({ status: "live", published_at: new Date().toISOString() })
    .eq("id", campaign.id)
  if (pubErr) throw pubErr

  return campaign!
}