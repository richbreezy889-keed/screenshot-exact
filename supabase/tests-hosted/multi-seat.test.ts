import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"

describe("multi-seat approval (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brandClient: ReturnType<typeof createAnonClient>
  let creatorClients: ReturnType<typeof createAnonClient>[]
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    // Create users via admin API
    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    for (let i = 1; i <= 6; i++) {
      await createUserViaAdmin(serviceClient, {
        email: `hosted-creator-${i}@biboh.test`,
        password: "HostedTest123!",
        role: "creator",
      })
    }

    brandClient = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    creatorClients = []
    for (let i = 1; i <= 6; i++) {
      creatorClients.push(await signInUser(createAnonClient(), `hosted-creator-${i}@biboh.test`, "HostedTest123!"))
    }

    const { data: profiles } = await serviceClient.from("profiles").select("id, role").eq("email", BRAND_1_EMAIL).single()
    brandId = profiles!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("exactly 3 approvals win when 6 compete for 3 seats", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-multi-seat-${round}-${Date.now()}`

      const { data: campaign, error: camErr } = await brandClient
        .from("campaigns")
        .insert({
          title: uniqueTitle,
          brand_id: brandId,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: 3000000,
          creators_needed: 3,
          videos_per_creator: 2,
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

      // All 6 creators apply
      const appInserts = creatorClients.map(async (c, i) => {
        const cid = await getUserId(c)
        return c.from("applications").insert({
          campaign_id: campaign.id,
          creator_id: cid!,
        })
      })
      const appResults = await Promise.all(appInserts)
      for (const res of appResults) {
        if (res.error) throw res.error
      }

      // Fetch the application IDs
      const { data: apps } = await serviceClient
        .from("applications")
        .select("id, creator_id")
        .eq("campaign_id", campaign.id)

      // All 6 try to approve at once
      const results = await Promise.allSettled(
        apps!.map((a) =>
          brandClient.from("applications").update({ status: "approved" }).eq("id", a.id).select().single()
        )
      )

      const approvedCount = results.filter(
        (r) => r.status === "fulfilled" && (r.value as any).data?.status === "approved"
      ).length
      const errorCount = results.filter((r) => r.status === "rejected").length

      expect(approvedCount).toBe(3)
      expect(errorCount).toBe(3)

      const { data: appsDb } = await serviceClient
        .from("applications")
        .select("status")
        .eq("campaign_id", campaign.id)
      const approvedDbCount = appsDb!.filter((a) => a.status === "approved").length
      expect(approvedDbCount).toBe(3)

      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})