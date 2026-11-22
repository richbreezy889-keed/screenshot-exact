import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import {
  ensureUser,
  createBrand,
  ensureCreatorRow,
  createLiveCampaign,
  type TestUser,
} from "./support/fixtures"

const ROUNDS = 30

describe("double submit (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand: TestUser
  let c1: TestUser
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    brand = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    c1 = await ensureUser(serviceClient, "hosted-creator-1@biboh.test", "creator")

    await ensureCreatorRow(c1.client)

    brandId = await createBrand(brand.client, "Test Brand 1")
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: exactly one submission wins (cap=1)`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-double-submit-${round}-${Date.now()}`,
        creators_needed: 1,
        videos_per_creator: 1,
      })

      // Creator applies and gets approved
      const { data: app, error: appErr } = await c1.client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c1.id })
        .select()
        .single()
      if (appErr) throw appErr

      const { error: approveErr } = await brand.client
        .from("applications")
        .update({ status: "approved" })
        .eq("id", app.id)
      if (approveErr) throw approveErr

      // Two submission inserts at once
      const results = await Promise.allSettled([
        c1.client.from("submissions").insert({
          application_id: app.id,
          campaign_id: campaign.id,
          creator_id: c1.id,
          platform: "tiktok",
          video_url: `https://example.com/video-${round}-a`,
          posted_at: new Date().toISOString(),
        }),
        c1.client.from("submissions").insert({
          application_id: app.id,
          campaign_id: campaign.id,
          creator_id: c1.id,
          platform: "tiktok",
          video_url: `https://example.com/video-${round}-b`,
          posted_at: new Date().toISOString(),
        }),
      ])

      let successCount = 0
      let errorCount = 0

      for (const r of results) {
        if (r.status === "rejected") {
          throw new Error(`Unexpected rejected promise: ${(r as any).reason}`)
        }
        const result = r.value as { data: unknown; error: unknown }
        if (result.error) {
          errorCount++
          // Loser must have error.code === "23514" AND message containing "submission cap"
          expect((result.error as { code?: string }).code).toBe("23514")
          expect(((result.error as { message?: string }).message ?? "").toLowerCase()).toContain("submission cap")
        } else {
          successCount++
        }
      }

      expect(successCount).toBe(1)
      expect(errorCount).toBe(1)

      // Verify in DB
      const { data: subs } = await serviceClient
        .from("submissions")
        .select("id")
        .eq("application_id", app.id)
      expect(subs!.length).toBe(1)

      // Cleanup campaign in finally
      try {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      } catch {}
    })
  }
})