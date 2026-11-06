import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"

describe("real-token attacks", () => {
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

  it("creator cannot perform admin-only actions", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-attacks-${round}-${Date.now()}`

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
          videos_per_creator: 1,
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

      const { data: app, error: appErr } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: (await getUserId(c1Client))! })
        .select()
        .single()
      if (appErr) throw appErr

      // Attack 1: Creator tries to approve their own application (must be denied)
      const { error: selfApproveErr } = await c1Client
        .from("applications")
        .update({ status: "approved" })
        .eq("id", app.id)
      expect(selfApproveErr).toBeTruthy()

      // Attack 2: Creator tries to set campaign status (must be denied)
      const { error: setStatusErr } = await c1Client
        .from("campaigns")
        .update({ status: "live" })
        .eq("id", campaign.id)
      expect(setStatusErr).toBeTruthy()

      // Attack 3: Creator tries to edit platform_settings (must be denied)
      const { error: settingsErr } = await c1Client
        .from("platform_settings")
        .update({ fee_bps: 5000 })
        .eq("id", true)
      expect(settingsErr).toBeTruthy()

      // Attack 4: Creator tries to edit view_checkpoints (must be denied)
      const { error: checkpointErr } = await c1Client
        .from("view_checkpoints")
        .update({ status: "verified", views: 9999 })
        .eq("id", "00000000-0000-0000-0000-000000000000")
      expect(checkpointErr).toBeTruthy()

      // Attack 5: Creator tries to insert application as 'approved' (must be denied)
      const { error: insertApprovedErr } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: (await getUserId(c1Client))!, status: "approved" })
      expect(insertApprovedErr).toBeTruthy()

      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})