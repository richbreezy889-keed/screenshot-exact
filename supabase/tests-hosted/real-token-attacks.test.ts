import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import {
  ensureUser,
  createBrand,
  ensureCreatorRow,
  createLiveCampaign,
  type TestUser,
} from "./support/fixtures"

describe("real-token attacks", () => {
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

  async function liveCampaign(tag: string, opts: { videos?: number } = {}) {
    return createLiveCampaign(brand.client, serviceClient, brandId, {
      title: `hosted-test-attack-${tag}-${Date.now()}`,
      creators_needed: 1,
      videos_per_creator: opts.videos ?? 1,
    })
  }

  async function apply(campaignId: string) {
    const { data, error } = await c1.client
      .from("applications")
      .insert({ campaign_id: campaignId, creator_id: c1.id })
      .select()
      .single()
    if (error) throw error
    return data as { id: string; status: string }
  }

  async function approve(applicationId: string) {
    const { error } = await brand.client
      .from("applications")
      .update({ status: "approved" })
      .eq("id", applicationId)
    if (error) throw error
  }

  async function appStatus(applicationId: string): Promise<string> {
    const { data, error } = await serviceClient
      .from("applications")
      .select("status")
      .eq("id", applicationId)
      .single()
    if (error) throw error
    return data.status
  }

  async function dropCampaign(id: string) {
    await serviceClient.from("campaigns").delete().eq("id", id)
  }

  it("a creator cannot insert an application already approved", async () => {
    const campaign = await liveCampaign("ins-approved")
    try {
      const { error } = await c1.client
        .from("applications")
        .insert({ campaign_id: campaign.id, creator_id: c1.id, status: "approved" })
      expect(error).not.toBeNull()

      const { data: rows } = await serviceClient
        .from("applications")
        .select("id")
        .eq("campaign_id", campaign.id)
      expect(rows ?? []).toHaveLength(0)
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a creator cannot approve their own application", async () => {
    const campaign = await liveCampaign("self-approve")
    try {
      const app = await apply(campaign.id)
      await c1.client.from("applications").update({ status: "approved" }).eq("id", app.id)
      expect(await appStatus(app.id)).toBe("applied")
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a creator cannot reset an approved application back to applied", async () => {
    const campaign = await liveCampaign("reset")
    try {
      const app = await apply(campaign.id)
      await approve(app.id)

      const { error } = await c1.client
        .from("applications")
        .update({ status: "applied" })
        .eq("id", app.id)
      expect(error).not.toBeNull()
      expect(await appStatus(app.id)).toBe("approved")
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a creator cannot withdraw another creator's application", async () => {
    const campaign = await liveCampaign("cross-withdraw")
    try {
      const app = await apply(campaign.id)
      await c2.client.from("applications").update({ status: "withdrawn" }).eq("id", app.id)
      expect(await appStatus(app.id)).toBe("applied")
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a creator cannot change a campaign's status or terms", async () => {
    const campaign = await liveCampaign("creator-campaign")
    try {
      await c1.client
        .from("campaigns")
        .update({ status: "draft", budget: 1 })
        .eq("id", campaign.id)

      const { data, error } = await serviceClient
        .from("campaigns")
        .select("status, budget")
        .eq("id", campaign.id)
        .single()
      if (error) throw error
      expect(data.status).toBe("live")
      expect(Number(data.budget)).toBe(1_000_000)
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a brand cannot change the terms of a published campaign", async () => {
    const campaign = await liveCampaign("brand-terms")
    try {
      const { error } = await brand.client
        .from("campaigns")
        .update({ budget: 5 })
        .eq("id", campaign.id)
      expect(error).not.toBeNull()

      const { data, error: readErr } = await serviceClient
        .from("campaigns")
        .select("budget")
        .eq("id", campaign.id)
        .single()
      if (readErr) throw readErr
      expect(Number(data.budget)).toBe(1_000_000)
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("a brand cannot publish its own campaign", async () => {
    const title = `hosted-test-attack-publish-${Date.now()}`
    const { data: draft, error: insErr } = await brand.client
      .from("campaigns")
      .insert({
        title,
        brand_id: brandId,
        status: "draft",
        platforms: ["tiktok"],
        rate_per_1k: 4000,
        budget: 1_000_000,
        creators_needed: 1,
        videos_per_creator: 1,
        deadline: "2026-12-31",
      })
      .select()
      .single()
    if (insErr) throw insErr
    try {
      await brand.client.from("campaigns").update({ status: "live" }).eq("id", draft.id)
      const { data, error } = await serviceClient
        .from("campaigns")
        .select("status")
        .eq("id", draft.id)
        .single()
      if (error) throw error
      expect(data.status).toBe("draft")
    } finally {
      await dropCampaign(draft.id)
    }
  })

  it("a brand cannot insert a campaign that is already live", async () => {
    const title = `hosted-test-attack-livein-${Date.now()}`
    const { data } = await brand.client
      .from("campaigns")
      .insert({
        title,
        brand_id: brandId,
        status: "live",
        platforms: ["tiktok"],
        rate_per_1k: 4000,
        budget: 1_000_000,
        creators_needed: 1,
        videos_per_creator: 1,
        deadline: "2026-12-31",
      })
      .select("id")
    const { data: rows, error } = await serviceClient
      .from("campaigns")
      .select("id, status")
      .eq("title", title)
    if (error) throw error
    for (const r of rows ?? []) await dropCampaign(r.id)
    expect((rows ?? []).filter((r) => r.status === "live")).toHaveLength(0)
    void data
  })

  it("a creator cannot edit platform settings", async () => {
    const { data: before, error: readErr } = await serviceClient
      .from("platform_settings")
      .select("*")
      .eq("id", true)
      .single()
    if (readErr) throw readErr

    try {
      await c1.client.from("platform_settings").update({ min_rate_per_1k: 1 }).eq("id", true)
      await brand.client.from("platform_settings").update({ min_rate_per_1k: 1 }).eq("id", true)

      const { data: after, error } = await serviceClient
        .from("platform_settings")
        .select("*")
        .eq("id", true)
        .single()
      if (error) throw error
      expect(after.min_rate_per_1k).toBe(before.min_rate_per_1k)
    } finally {
      // If an attack worked, put the original value back so the project stays clean.
      await serviceClient
        .from("platform_settings")
        .update({ min_rate_per_1k: before.min_rate_per_1k })
        .eq("id", true)
    }
  })

  it("a creator and a brand cannot edit view checkpoints", async () => {
    const campaign = await liveCampaign("checkpoint")
    try {
      const app = await apply(campaign.id)
      await approve(app.id)
      const { data: sub, error: subErr } = await c1.client
        .from("submissions")
        .insert({
          application_id: app.id,
          campaign_id: campaign.id,
          creator_id: c1.id,
          platform: "tiktok",
          video_url: `https://example.com/attack-${Date.now()}`,
          posted_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      if (subErr) throw subErr

      const read = async () => {
        const { data, error } = await serviceClient
          .from("view_checkpoints")
          .select("views, status, checkpoint_at")
          .eq("submission_id", sub.id)
          .single()
        if (error) throw error
        return data
      }
      const before = await read()

      for (const actor of [c1, brand]) {
        await actor.client
          .from("view_checkpoints")
          .update({ views: 9_999_999, status: "verified" })
          .eq("submission_id", sub.id)
      }

      const after = await read()
      expect(after.views).toBe(before.views)
      expect(after.status).toBe(before.status)
      expect(after.checkpoint_at).toBe(before.checkpoint_at)
    } finally {
      await dropCampaign(campaign.id)
    }
  })

  it("an anonymous visitor cannot read applications or submissions", async () => {
    const campaign = await liveCampaign("anon")
    try {
      const app = await apply(campaign.id)
      const anon = createAnonClient()

      const a = await anon.from("applications").select("id").eq("id", app.id)
      expect(a.error !== null || (a.data ?? []).length === 0).toBe(true)

      const s = await anon.from("submissions").select("id").limit(1)
      expect(s.error !== null || (s.data ?? []).length === 0).toBe(true)
    } finally {
      await dropCampaign(campaign.id)
    }
  })
})