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

type DbError = { code?: string; message?: string } | null

describe("withdraw vs submit (concurrency)", () => {
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

  // Creates a live campaign with the creator applied and approved.
  async function approvedApplication(title: string) {
    const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
      title,
      creators_needed: 1,
      videos_per_creator: 1,
    })

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

    return { campaign, app }
  }

  const withdraw = (applicationId: string) =>
    c1.client
      .from("applications")
      .update({ status: "withdrawn" })
      .eq("id", applicationId)
      .select("id, status")

  const submit = (applicationId: string, campaignId: string, url: string) =>
    c1.client.from("submissions").insert({
      application_id: applicationId,
      campaign_id: campaignId,
      creator_id: c1.id,
      platform: "tiktok",
      video_url: url,
      posted_at: new Date().toISOString(),
    })

  // Sanity checks run one at a time, so a race result can be trusted.
  it("sanity: a creator can withdraw an approved application with no videos", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-wvs-sanity-a-${Date.now()}`)
    try {
      const { data, error } = await withdraw(app.id)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].status).toBe("withdrawn")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  it("sanity: a creator cannot withdraw once a video is submitted", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-wvs-sanity-b-${Date.now()}`)
    try {
      const { error: subErr } = await submit(app.id, campaign.id, `https://example.com/sanity-${Date.now()}`)
      expect(subErr).toBeNull()

      const { data } = await withdraw(app.id)
      // Blocked either with an error or silently with zero rows. Both are fine;
      // what matters is that the application is still approved.
      expect(data ?? []).toHaveLength(0)

      const { data: row, error: readErr } = await serviceClient
        .from("applications")
        .select("status")
        .eq("id", app.id)
        .single()
      if (readErr) throw readErr
      expect(row.status).toBe("approved")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: never withdrawn AND has a video`, async () => {
      const { campaign, app } = await approvedApplication(
        `hosted-test-wvs-${round}-${Date.now()}`,
      )

      try {
        const results = await Promise.allSettled([
          withdraw(app.id),
          submit(app.id, campaign.id, `https://example.com/wvs-${round}-${Date.now()}`),
        ])

        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`Unexpected rejected promise: ${(r as any).reason}`)
          }
        }

        // The invariant, checked from the database first.
        const { data: appRow, error: appReadErr } = await serviceClient
          .from("applications")
          .select("status")
          .eq("id", app.id)
          .single()
        if (appReadErr) throw appReadErr

        const { data: subs, error: subReadErr } = await serviceClient
          .from("submissions")
          .select("id")
          .eq("application_id", app.id)
        if (subReadErr) throw subReadErr

        const withdrawn = appRow.status === "withdrawn"
        const hasVideo = subs!.length > 0
        expect(
          withdrawn && hasVideo,
          `INVARIANT BROKEN: application is withdrawn and has ${subs!.length} video(s)`,
        ).toBe(false)

        const [wRes, sRes] = results.map(
          (r) => (r as PromiseFulfilledResult<{ data: unknown; error: DbError }>).value,
        )

        // A withdrawal counts only if it changed exactly one row.
        const withdrawApplied =
          !wRes.error && Array.isArray(wRes.data) && wRes.data.length === 1
        if (wRes.error) {
          expect(["42501", "23514"]).toContain(wRes.error.code)
        }

        const submitSucceeded = !sRes.error
        if (sRes.error) {
          expect(sRes.error.code).toBe("23514")
          expect((sRes.error.message ?? "").toLowerCase()).toContain("approved")
        }

        // Exactly one of the two actions took effect.
        expect(
          withdrawApplied !== submitSucceeded,
          `withdrawApplied=${withdrawApplied} submitSucceeded=${submitSucceeded}`,
        ).toBe(true)

        // And the database agrees with whichever one won.
        if (withdrawApplied) {
          expect(appRow.status).toBe("withdrawn")
          expect(subs).toHaveLength(0)
        } else {
          expect(appRow.status).toBe("approved")
          expect(subs).toHaveLength(1)
        }
      } finally {
        await serviceClient.from("campaigns").delete().eq("id", campaign.id)
      }
    })
  }
})