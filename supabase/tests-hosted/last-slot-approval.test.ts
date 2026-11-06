import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"
const CREATOR_2_EMAIL = "hosted-creator-2@biboh.test"
const CREATOR_2_PASSWORD = "HostedTest123!"

describe("last-slot approval (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brandClient: ReturnType<typeof createAnonClient>
  let c1Client: ReturnType<typeof createAnonClient>
  let c2Client: ReturnType<typeof createAnonClient>
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    // Create users via admin API
    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_1_EMAIL, password: CREATOR_1_PASSWORD, role: "creator" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_2_EMAIL, password: CREATOR_2_PASSWORD, role: "creator" })

    // Sign in to get real JWT clients
    brandClient = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    c1Client = await signInUser(createAnonClient(), CREATOR_1_EMAIL, CREATOR_1_PASSWORD)
    c2Client = await signInUser(createAnonClient(), CREATOR_2_EMAIL, CREATOR_2_PASSWORD)

    // Get brand owner's profile id
    const { data: profiles } = await serviceClient.from("profiles").select("id, role").eq("email", BRAND_1_EMAIL).single()
    brandId = profiles!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("exactly one approval wins the last slot", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-last-slot-${round}-${Date.now()}`

      // Brand creates campaign (draft)
      const { data: campaign, error: camErr } = await brandClient
        .from("campaigns")
        .insert({
          title: uniqueTitle,
          brand_id: brandId,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: 1000000,
          creators_needed: 1,
          videos_per_creator: 2,
          deadline: "2026-12-31",
        })
        .select()
        .single()
      if (camErr) throw camErr

      // Publish via service role
      const { error: pubErr } = await serviceClient
        .from("campaigns")
        .update({ status: "live", published_at: new Date().toISOString() })
        .eq("id", campaign.id)
      if (pubErr) throw pubErr

      // Creator 1 applies
      const c1Id = await getUserId(c1Client)
      const { data: app1, error: app1Err } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c1Id! })
        .select()
        .single()
      if (app1Err) throw app1Err

      // Creator 2 applies
      const c2Id = await getUserId(c2Client)
      const { data: app2, error: app2Err } = await c2Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c2Id! })
        .select()
        .single()
      if (app2Err) throw app2Err

      // Both brands try to approve at once
      const results = await Promise.allSettled([
        brandClient.from("applications").update({ status: "approved" }).eq("id", app1.id).select().single(),
        brandClient.from("applications").update({ status: "approved" }).eq("id", app2.id).select().single(),
      ])

      const approvedCount = results.filter(
        (r) => r.status === "fulfilled" && (r.value as any).data?.status === "approved"
      ).length
      const errorCount = results.filter((r) => r.status === "rejected").length

      expect(approvedCount).toBe(1)
      expect(errorCount).toBe(1)

      // Verify in DB
      const { data: apps } = await serviceClient
        .from("applications")
        .select("status")
        .eq("campaign_id", campaign.id)
      const approvedDbCount = apps!.filter((a) => a.status === "approved").length
      expect(approvedDbCount).toBe(1)

      // Cleanup campaign
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})