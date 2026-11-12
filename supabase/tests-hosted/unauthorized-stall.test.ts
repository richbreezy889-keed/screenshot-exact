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

const ROUNDS = 10
const SELF_APPROVE_ATTEMPTS = 8
const OUTSIDER_ATTEMPTS = 4
const MAX_LEGIT_MS = 8000

describe("unauthorized stall (concurrency)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand: TestUser
  let otherBrand: TestUser
  let c1: TestUser
  let c2: TestUser
  let brandId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()
    brand = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    otherBrand = await ensureUser(serviceClient, "hosted-brand-owner-2@biboh.test", "brand")
    c1 = await ensureUser(serviceClient, "hosted-creator-1@biboh.test", "creator")
    c2 = await ensureUser(serviceClient, "hosted-creator-2@biboh.test", "creator")
    await ensureCreatorRow(c1.client)
    await ensureCreatorRow(c2.client)

    brandId = await createBrand(brand.client, "Test Brand 1")
    await createBrand(otherBrand.client, "Test Brand 2")
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: failed approvals do not delay a real approval`, async () => {
      const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
        title: `hosted-test-stall-${round}-${Date.now()}`,
        creators_needed: 2,
        videos_per_creator: 1,
      })

      try {
        const { data: app1, error: e1 } = await c1.client
          .from("applications")
          .insert({ campaign_id: campaign.id, creator_id: c1.id })
          .select("id")
          .single()
        if (e1) throw e1

        const { data: app2, error: e2 } = await c2.client
          .from("applications")
          .insert({ campaign_id: campaign.id, creator_id: c2.id })
          .select("id")
          .single()
        if (e2) throw e2

        // The real approval is timed on its own.
        const legit = (async () => {
          const started = Date.now()
          const result = await brand.client
            .from("applications")
            .update({ status: "approved" })
            .eq("id", app1.id)
            .select("id, status")
          return { result, ms: Date.now() - started }
        })()

        // Creator 2 keeps trying to approve their own application.
        const selfAttacks = Array.from({ length: SELF_APPROVE_ATTEMPTS }, () =>
          c2.client.from("applications").update({ status: "approved" }).eq("id", app2.id),
        )

        // Another brand's owner keeps trying to approve creator 1's application.
        const outsiderAttacks = Array.from({ length: OUTSIDER_ATTEMPTS }, () =>
          otherBrand.client.from("applications").update({ status: "approved" }).eq("id", app1.id),
        )

        const [legitOutcome] = await Promise.all([
          legit,
          Promise.allSettled([...selfAttacks, ...outsiderAttacks]),
        ])

        // The real approval must have worked, and quickly.
        expect(legitOutcome.result.error).toBeNull()
        expect(legitOutcome.result.data).toHaveLength(1)
        expect(legitOutcome.result.data![0].status).toBe("approved")
        expect(
          legitOutcome.ms,
          `real approval took ${legitOutcome.ms} ms while under attack`,
        ).toBeLessThan(MAX_LEGIT_MS)

        // And none of the attacks changed anything.
        const { data: rows, error: readErr } = await serviceClient
          .from("applications")
          .select("id, status")
          .eq("campaign_id", campaign.id)
        if (readErr) throw readErr
        const byId = new Map(rows!.map((r) => [r.id, r.status]))
        expect(byId.get(app1.id)).toBe("approved")
        expect(byId.get(app2.id)).toBe("applied")
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})