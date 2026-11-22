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

describe("double apply (concurrency)", () => {
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
    it(`round ${round}: the same creator applying twice makes exactly one application`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-double-apply-${round}-${Date.now()}`,
        creators_needed: 2,
        videos_per_creator: 1,
      })

      try {
        const apply = () =>
          c1.client
            .from("applications")
            .insert({ campaign_id: campaign.id, creator_id: c1.id })
            .select("id")

        const results = await Promise.allSettled([apply(), apply()])

        let winners = 0
        let losers = 0

        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`Unexpected rejected promise: ${(r as any).reason}`)
          }
          const { data, error } = r.value as {
            data: { id: string }[] | null
            error: { code?: string; message?: string } | null
          }
          if (error) {
            losers++
            expect(error.code, `unexpected error: ${error.message ?? ""}`).toBe("23505")
          } else {
            expect(data).toHaveLength(1)
            winners++
          }
        }

        expect(winners).toBe(1)
        expect(losers).toBe(1)

        const { data: rows, error: readErr } = await serviceClient
          .from("applications")
          .select("id")
          .eq("campaign_id", campaign.id)
          .eq("creator_id", c1.id)
        if (readErr) throw readErr
        expect(rows).toHaveLength(1)
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})