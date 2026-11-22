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
const CREATORS = 6
const SEATS = 3

describe("multi-seat approval (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand: TestUser
  let creators: TestUser[] = []
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    brand = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    for (let i = 1; i <= CREATORS; i++) {
      const creator = await ensureUser(serviceClient, `hosted-creator-${i}@biboh.test`, "creator")
      await ensureCreatorRow(creator.client)
      creators.push(creator)
    }

    brandId = await createBrand(brand.client, "Test Brand 1")
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: exactly ${SEATS} of ${CREATORS} approvals win`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-multi-seat-${round}-${Date.now()}`,
        budget: 3_000_000,
        creators_needed: SEATS,
        videos_per_creator: 1,
      })

      try {
        // All six creators apply (different creators, so no race here).
        const applied = await Promise.all(
          creators.map((c) =>
            c.client
              .from("applications")
              .insert({ campaign_id: campaign.id, creator_id: c.id })
              .select("id")
              .single(),
          ),
        )
        const applicationIds: string[] = []
        for (const a of applied) {
          if (a.error) throw a.error
          applicationIds.push(a.data!.id)
        }

        // The brand approves all six at once for three seats.
        const results = await Promise.allSettled(
          applicationIds.map((id) =>
            brand.client
              .from("applications")
              .update({ status: "approved" })
              .eq("id", id)
              .select("id, status"),
          ),
        )

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
            expect(data).toHaveLength(1) // a silent zero-row update is a failure
            expect(data![0].status).toBe("approved")
            winners++
          }
        }

        expect(winners).toBe(SEATS)
        expect(losers).toBe(CREATORS - SEATS)

        // The database must agree.
        const { data: rows, error: readErr } = await serviceClient
          .from("applications")
          .select("status")
          .eq("campaign_id", campaign.id)
        if (readErr) throw readErr
        expect(rows!.filter((a) => a.status === "approved")).toHaveLength(SEATS)
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})