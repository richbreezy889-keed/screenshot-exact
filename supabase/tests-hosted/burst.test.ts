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
const CAP = 3
const ATTEMPTS = 5

describe("burst submissions (concurrency)", () => {
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
    it(`round ${round}: exactly ${CAP} of ${ATTEMPTS} simultaneous videos win`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-burst-${round}-${Date.now()}`,
        creators_needed: 1,
        videos_per_creator: CAP,
      })

      try {
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

        // Five different videos at once for a cap of three.
        const results = await Promise.allSettled(
          Array.from({ length: ATTEMPTS }, (_, i) =>
            c1.client.from("submissions").insert({
              application_id: app.id,
              campaign_id: campaign.id,
              creator_id: c1.id,
              platform: "tiktok",
              video_url: `https://example.com/burst-${round}-${i}-${Date.now()}`,
              posted_at: new Date().toISOString(),
            }),
          ),
        )

        let winners = 0
        let losers = 0

        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`Unexpected rejected promise: ${(r as any).reason}`)
          }
          const { error } = r.value as { error: { code?: string; message?: string } | null }
          if (error) {
            losers++
            expect(error.code, `unexpected error: ${error.message ?? ""}`).toBe("23514")
            expect((error.message ?? "").toLowerCase()).toContain("submission cap")
          } else {
            winners++
          }
        }

        expect(winners).toBe(CAP)
        expect(losers).toBe(ATTEMPTS - CAP)

        const { data: rows, error: readErr } = await serviceClient
          .from("submissions")
          .select("id")
          .eq("application_id", app.id)
        if (readErr) throw readErr
        expect(rows).toHaveLength(CAP)
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})