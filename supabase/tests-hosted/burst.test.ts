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
const CREATOR_3_EMAIL = "hosted-creator-3@biboh.test"
const CREATOR_3_PASSWORD = "HostedTest123!"
const CREATOR_4_EMAIL = "hosted-creator-4@biboh.test"
const CREATOR_4_PASSWORD = "HostedTest123!"
const CREATOR_5_EMAIL = "hosted-creator-5@biboh.test"
const CREATOR_5_PASSWORD = "HostedTest123!"

describe("burst submissions (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brandClient: ReturnType<typeof createAnonClient>
  let creatorClients: ReturnType<typeof createAnonClient>[]
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    for (let i = 1; i <= 5; i++) {
      await createUserViaAdmin(serviceClient, {
        email: `hosted-creator-${i}@biboh.test`,
        password: "HostedTest123!",
        role: "creator",
      })
    }

    brandClient = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    creatorClients = []
    for (let i = 1; i <= 5; i++) {
      creatorClients.push(await signInUser(createAnonClient(), `hosted-creator-${i}@biboh.test`, "HostedTest123!"))
    }

    const { data: profiles } = await serviceClient.from("profiles").select("id, role").eq("email", BRAND_1_EMAIL).single()
    brandId = profiles!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("exactly 3 submissions when 5 insert at once (cap=3)", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-burst-${round}-${Date.now()}`

      const { data: campaign, error: camErr } = await brandClient
        .from("campaigns")
        .insert({
          title: uniqueTitle,
          brand_id: brandId,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: 1000000,
          creators_needed: 5,
          videos_per_creator: 3,
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

      // All 5 creators apply and get approved
      const appIds: string[] = []
      for (let i = 0; i < 5; i++) {
        const cid = await getUserId(creatorClients[i])
        const { data: app, error: appErr } = await creatorClients[i]
          .from("applications")
          .insert({ campaign_id: campaign.id, creator_id: cid! })
          .select()
          .single()
        if (appErr) throw appErr
        appIds.push(app.id)

        const { error: approveErr } = await brandClient
          .from("applications")
          .update({ status: "approved" })
          .eq("id", app.id)
        if (approveErr) throw approveErr
      }

      // 5 submissions at once
      const results = await Promise.allSettled(
        creatorClients.map(async (c, i) => {
          const cid = await getUserId(c)
          return c.from("submissions").insert({
            application_id: appIds[i],
            campaign_id: campaign.id,
            creator_id: cid!,
            platform: "tiktok",
            video_url: `https://example.com/video-${round}-${i}`,
            posted_at: new Date().toISOString(),
          })
        })
      )

      const successCount = results.filter((r) => r.status === "fulfilled").length
      const errorCount = results.filter((r) => r.status === "rejected").length

      expect(successCount).toBe(3)
      expect(errorCount).toBe(2)

      const { data: subs } = await serviceClient
        .from("submissions")
        .select("id")
        .eq("campaign_id", campaign.id)
      expect(subs!.length).toBe(3)

      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})