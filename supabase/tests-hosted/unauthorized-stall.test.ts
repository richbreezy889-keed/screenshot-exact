import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const BRAND_1_EMAIL = "hosted-brand-owner-1@biboh.test"
const BRAND_1_PASSWORD = "HostedTest123!"
const OUTSIDER_EMAIL = "hosted-outsider@biboh.test"
const OUTSIDER_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"

describe("unauthorized stall (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brandClient: ReturnType<typeof createAnonClient>
  let outsiderClient: ReturnType<typeof createAnonClient>
  let c1Client: ReturnType<typeof createAnonClient>
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    await createUserViaAdmin(serviceClient, { email: BRAND_1_EMAIL, password: BRAND_1_PASSWORD, role: "brand" })
    await createUserViaAdmin(serviceClient, { email: OUTSIDER_EMAIL, password: OUTSIDER_PASSWORD, role: "creator" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_1_EMAIL, password: CREATOR_1_PASSWORD, role: "creator" })

    brandClient = await signInUser(createAnonClient(), BRAND_1_EMAIL, BRAND_1_PASSWORD)
    outsiderClient = await signInUser(createAnonClient(), OUTSIDER_EMAIL, OUTSIDER_PASSWORD)
    c1Client = await signInUser(createAnonClient(), CREATOR_1_EMAIL, CREATOR_1_PASSWORD)

    const { data: profiles } = await serviceClient.from("profiles").select("id, role").eq("email", BRAND_1_EMAIL).single()
    brandId = profiles!.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("outsider approval attempts must not block legitimate approval beyond 5s", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const uniqueTitle = `hosted-test-stall-${round}-${Date.now()}`

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

      const c1Id = await getUserId(c1Client)
      const { data: app, error: appErr } = await c1Client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c1Id! })
        .select()
        .single()
      if (appErr) throw appErr

      // Outsider repeatedly tries to approve (will fail due to RLS)
      const outsiderAttacks = Array.from({ length: 10 }, () =>
        outsiderClient.from("applications").update({ status: "approved" }).eq("id", app.id)
      )

      const start = Date.now()

      // Legitimate approval runs alongside
      const results = await Promise.allSettled([
        brandClient.from("applications").update({ status: "approved" }).eq("id", app.id).select().single(),
        ...outsiderAttacks.map((a) => a.select().single()),
      ])

      const elapsed = Date.now() - start

      const brandResult = results[0] as PromiseFulfilledResult<{ data: { status: string } }>
      expect(brandResult.status).toBe("fulfilled")
      if (brandResult.status === "fulfilled") {
        expect(brandResult.value.data.status).toBe("approved")
      }

      // Legitimate approval must finish within 5 seconds
      expect(elapsed).toBeLessThan(5000)

      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})