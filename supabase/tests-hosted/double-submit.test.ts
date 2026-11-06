import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"

describe("double submit (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brandClient: ReturnType<typeof createAnonClient>
  let c1Client: ReturnType<typeof createAnonClient>
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_1_EMAIL, password: CREATOR_1_PASSWORD, role: "creator" })

    brandClient = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    c1Client = await signInUser(createAnonClient(), CREATOR_1_EMAIL, CREATOR_1_PASSWORD)

    const { data: profiles } = await serviceClient.from("profiles").select("id, role").eq("email", BRAND_1_EMAIL).single()
    brandId = profiles!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("exactly one submission when two insert at once (cap=1)", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-double-submit-${round}-${Date.now()}`

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
          max_videos_per_creator: 1,
          deadline: "2026-12-31",
        })
        .select()
        .single()
      if (camErr) throw camErr

      const { error: pubErr } = await serviceClient
        .from("campaigns")
        .update({ status: "live", published_at: new Date().toISOString() })
        .eq("id", campaign.id)
      if (pubErr) throw pubErr

      // Creator applies and gets approved
      const c1Id = await getUserId(c1Client)
      const { data: app, error: appErr } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c1Id! })
        .select()
        .single()
      if (appErr) throw appErr

      const { error: approveErr } = await brandClient
        .from("applications")
        .update({ status: "approved" })
        .eq("id", app.id)
      if (approveErr) throw approveErr

      // Two submission inserts at once
      const results = await Promise.allSettled([
        c1Client.from("submissions").insert({
          application_id: app.id,
          campaign_id: campaign.id,
          creator_id: c1Id!,
          platform: "tiktok",
          video_url: `https://example.com/video-${round}-a`,
          posted_at: new Date().toISOString(),
        }),
        c1Client.from("submissions").insert({
          application_id: app.id,
          campaign_id: campaign.id,
          creator_id: c1Id!,
          platform: "tiktok",
          video_url: `https://example.com/video-${round}-b`,
          posted_at: new Date().toISOString(),
        }),
      ])

      const successCount = results.filter((r) => r.status === "fulfilled").length
      const errorCount = results.filter((r) => r.status === "rejected").length

      expect(successCount).toBe(1)
      expect(errorCount).toBe(1)

      const { data: subs } = await serviceClient
        .from("submissions")
        .select("id")
        .eq("application_id", app.id)
      expect(subs!.length).toBe(1)

      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})