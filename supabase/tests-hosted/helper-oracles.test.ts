import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"
const BRAND_2_EMAIL = "hosted-brand-owner-2@biboh.test"
const BRAND_2_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"

describe("helper oracles (data isolation)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand1Client: ReturnType<typeof createAnonClient>
  let brand2Client: ReturnType<typeof createAnonClient>
  let c1Client: ReturnType<typeof createAnonClient>
  let brand1Id: string
  let brand2Id: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    await createUserViaAdmin(serviceClient, { email: BRAND_2_EMAIL, password: BRAND_2_PASSWORD, role: "brand" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_1_EMAIL, password: CREATOR_1_PASSWORD, role: "creator" })

    brand1Client = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    brand2Client = await signInUser(createAnonClient(), BRAND_2_EMAIL, BRAND_2_PASSWORD)
    c1Client = await signInUser(createAnonClient(), CREATOR_1_EMAIL, CREATOR_1_PASSWORD)

    const { data: p1 } = await serviceClient.from("profiles").select("id").eq("email", BRAND_1_EMAIL).single()
    brand1Id = p1!.id
    const { data: p2 } = await serviceClient.from("profiles").select("id").eq("email", BRAND_2_EMAIL).single()
    brand2Id = p2!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("creator cannot see another brand's data via RPC oracles", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-oracles-${round}-${Date.now()}`

      // Brand 2 creates a campaign
      const { data: campaignB2, error: camErr } = await brand2Client
        .from("campaigns")
        .insert({
          title: uniqueTitle,
          brand_id: brand2Id,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: 1000000,
          creators_needed: 1,
          max_videos_per_creator: 1,
          deadline: "2026-12-31",
        })
        .select()
        .single()
      if (camErr) throw camErr

      const { error: pubErr } = await serviceClient
        .from("campaigns")
        .update({ status: "live", published_at: new Date().toISOString() })
        .eq("id", campaignB2.id)
      if (pubErr) throw pubErr

      // Creator 1 applies to Brand 2's campaign
      const c1Id = await getUserId(c1Client)
      const { data: app, error: appErr } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaignB2.id, creator_id: c1Id! })
        .select()
        .single()
      if (appErr) throw appErr

      // Creator calls RPC oracles using Brand 2's data - should reveal nothing
      const oracleCalls = [
        c1Client.rpc("can_view_submission", { target_submission_id: "00000000-0000-0000-0000-000000000000" }),
        c1Client.rpc("application_approved_at", { app_id: app.id }),
        c1Client.rpc("application_has_submissions", { app_id: app.id }),
        c1Client.rpc("campaign_has_applications", { campaign_id: campaignB2.id }),
        c1Client.rpc("campaign_is_live", { target_campaign_id: campaignB2.id }),
        c1Client.rpc("shares_brand_with", { target_user_id: c1Id! }),
      ]

      const oracleResults = await Promise.allSettled(oracleCalls)

      // All should return null/false/error - no data leakage
      for (const r of oracleResults) {
        if (r.status === "fulfilled") {
          const val = (r.value as any).data ?? (r.value as any)
          // Should be null, false, or empty - not revealing data
          expect(val).toSatisfy((v: any) => v === null || v === false || v === undefined || v === 0)
        }
        // Rejected is also acceptable (error = denied)
      }

      await serviceClient.from("campaigns").delete().eq("id", campaignB2.id)
    }
  })
})