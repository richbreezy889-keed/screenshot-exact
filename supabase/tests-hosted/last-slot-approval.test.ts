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

describe("last-slot approval (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand: TestUser
  let c1: TestUser
  let c2: TestUser
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    brand = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    c1 = await ensureUser(serviceClient, "hosted-creator-1@biboh.test", "creator")
    c2 = await ensureUser(serviceClient, "hosted-creator-2@biboh.test", "creator")

    await ensureCreatorRow(c1.client)
    await ensureCreatorRow(c2.client)

    brandId = await createBrand(brand.client, "Test Brand 1")
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: exactly one approval wins the last slot`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-last-slot-${round}-${Date.now()}`,
        creators_needed: 1,
        videos_per_creator: 1,
      })

      try {
        const { data: app1, error: app1Err } = await c1.client
          .from("applications")
          .insert({ campaign_id: campaign.id, creator_id: c1.id })
          .select()
          .single()
        if (app1Err) throw app1Err

        const { data: app2, error: app2Err } = await c2.client
          .from("applications")
          .insert({ campaign_id: campaign.id, creator_id: c2.id })
          .select()
          .single()
        if (app2Err) throw app2Err

        const approve = (applicationId: string) =>
          brand.client
            .from("applications")
            .update({ status: "approved" })
            .eq("id", applicationId)
            .select("id, status")

        // Both approvals at once for a campaign with exactly one slot
        const results = await Promise.allSettled([approve(app1.id), approve(app2.id)])

        let winners = 0
        let losers = 0

        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`Unexpected rejected promise: ${(r as any).reason}`)
          }
          const { data, error } = r.value as {
            data: { id: string; status: string }[] | null
            error: { code?: string; message?: string } | null
          }
          if (error) {
            losers++
            expect(error.code).toBe("23514")
            expect((error.message ?? "").toLowerCase()).toContain("creator cap")
          } else {
            // An update that matched no rows returns no error, so insist on one row
            expect(data).toHaveLength(1)
            expect(data![0].status).toBe("approved")
            winners++
          }
        }

        expect(winners).toBe(1)
        expect(losers).toBe(1)

        // Verify in the database
        const { data: apps, error: readErr } = await serviceClient
          .from("applications")
          .select("status")
          .eq("campaign_id", campaign.id)
        if (readErr) throw readErr
        expect(apps!.filter((a) => a.status === "approved")).toHaveLength(1)
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})