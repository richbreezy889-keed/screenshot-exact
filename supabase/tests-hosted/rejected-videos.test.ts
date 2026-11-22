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

describe("rejected videos and the video cap", () => {
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

  async function approvedApplication(title: string, videos: number) {
    const campaign = await createLiveCampaign(brand.client, serviceClient, brandId, {
      title,
      creators_needed: 1,
      videos_per_creator: videos,
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

  const submit = (applicationId: string, campaignId: string, tag: string) =>
    c1.client
      .from("submissions")
      .insert({
        application_id: applicationId,
        campaign_id: campaignId,
        creator_id: c1.id,
        platform: "tiktok",
        video_url: `https://example.com/${tag}-${Date.now()}`,
        posted_at: new Date().toISOString(),
      })
      .select("id")
      .single()

  const reject = (submissionId: string) =>
    brand.client
      .from("submissions")
      .update({ status: "rejected" })
      .eq("id", submissionId)
      .select("id, status")

  async function statusOf(submissionId: string): Promise<string> {
    const { data, error } = await serviceClient
      .from("submissions")
      .select("status")
      .eq("id", submissionId)
      .single()
    if (error) throw error
    return data.status
  }

  it("a live video at the cap blocks another video", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-rej-a-${Date.now()}`, 1)
    try {
      const first = await submit(app.id, campaign.id, "a1")
      expect(first.error).toBeNull()
      const second = await submit(app.id, campaign.id, "a2")
      expect(second.error).not.toBeNull()
      expect(second.error!.code).toBe("23514")
      expect((second.error!.message ?? "").toLowerCase()).toContain("submission cap")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  it("after a rejection the creator can post a replacement", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-rej-b-${Date.now()}`, 1)
    try {
      const first = await submit(app.id, campaign.id, "b1")
      expect(first.error).toBeNull()

      const rejected = await reject(first.data!.id)
      expect(rejected.error).toBeNull()
      expect(rejected.data).toHaveLength(1)
      expect(rejected.data![0].status).toBe("rejected")

      const replacement = await submit(app.id, campaign.id, "b2")
      expect(replacement.error).toBeNull()
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  it("a creator cannot reopen their own rejected video", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-rej-c-${Date.now()}`, 1)
    try {
      const first = await submit(app.id, campaign.id, "c1")
      expect(first.error).toBeNull()
      expect((await reject(first.data!.id)).error).toBeNull()

      // Blocked either with an error or silently with zero rows.
      const { data } = await c1.client
        .from("submissions")
        .update({ status: "awaiting" })
        .eq("id", first.data!.id)
        .select("id, status")
      expect(data ?? []).toHaveLength(0)

      expect(await statusOf(first.data!.id)).toBe("rejected")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  it("platform-side reopen is blocked when it would exceed the cap", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-rej-d-${Date.now()}`, 1)
    try {
      const first = await submit(app.id, campaign.id, "d1")
      expect(first.error).toBeNull()
      expect((await reject(first.data!.id)).error).toBeNull()

      const replacement = await submit(app.id, campaign.id, "d2")
      expect(replacement.error).toBeNull()

      // The service role skips the creator guard; only the cap trigger can stop this.
      const { error } = await serviceClient
        .from("submissions")
        .update({ status: "awaiting" })
        .eq("id", first.data!.id)
      expect(error).not.toBeNull()
      expect(error!.code).toBe("23514")
      expect((error!.message ?? "").toLowerCase()).toContain("submission cap")

      expect(await statusOf(first.data!.id)).toBe("rejected")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })

  it("platform-side reopen works when there is room under the cap", async () => {
    const { campaign, app } = await approvedApplication(`hosted-test-rej-e-${Date.now()}`, 1)
    try {
      const first = await submit(app.id, campaign.id, "e1")
      expect(first.error).toBeNull()
      expect((await reject(first.data!.id)).error).toBeNull()

      const { data, error } = await serviceClient
        .from("submissions")
        .update({ status: "awaiting" })
        .eq("id", first.data!.id)
        .select("id, status")
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].status).toBe("awaiting")
    } finally {
      await serviceClient.from("campaigns").delete().eq("id", campaign.id)
    }
  })
})