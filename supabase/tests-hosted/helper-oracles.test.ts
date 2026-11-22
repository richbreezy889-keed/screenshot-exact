import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import {
  ensureUser,
  createBrand,
  ensureCreatorRow,
  createLiveCampaign,
  type TestUser,
} from "./support/fixtures"

describe("helper oracles (data isolation)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand1: TestUser
  let brand2: TestUser
  let c1: TestUser // owns the application and video in Brand 1's campaign
  let c2: TestUser // outsider creator
  let brand1Id: string
  let liveId: string
  let draftId: string
  let appId: string
  let subId: string

  beforeAll(async () => {
    serviceClient = createServiceClient()

    brand1 = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    brand2 = await ensureUser(serviceClient, "hosted-brand-owner-2@biboh.test", "brand")
    c1 = await ensureUser(serviceClient, "hosted-creator-1@biboh.test", "creator")
    c2 = await ensureUser(serviceClient, "hosted-creator-2@biboh.test", "creator")
    await ensureCreatorRow(c1.client)
    await ensureCreatorRow(c2.client)

    brand1Id = await createBrand(brand1.client, "Test Brand 1")
    await createBrand(brand2.client, "Test Brand 2")

    const live = await createLiveCampaign(brand1.client, serviceClient, brand1Id, {
      title: `hosted-test-oracle-live-${Date.now()}`,
      creators_needed: 1,
      videos_per_creator: 1,
    })
    liveId = live.id

    const { data: draft, error: draftErr } = await brand1.client
      .from("campaigns")
      .insert({
        title: `hosted-test-oracle-draft-${Date.now()}`,
        brand_id: brand1Id,
        status: "draft",
        platforms: ["tiktok"],
        rate_per_1k: 4000,
        budget: 1_000_000,
        creators_needed: 1,
        videos_per_creator: 1,
        deadline: "2026-12-31",
      })
      .select("id")
      .single()
    if (draftErr) throw draftErr
    draftId = draft.id

    const { data: app, error: appErr } = await c1.client
      .from("applications")
      .insert({ campaign_id: liveId, creator_id: c1.id })
      .select("id")
      .single()
    if (appErr) throw appErr
    appId = app.id

    const { error: approveErr } = await brand1.client
      .from("applications")
      .update({ status: "approved" })
      .eq("id", appId)
    if (approveErr) throw approveErr

    const { data: sub, error: subErr } = await c1.client
      .from("submissions")
      .insert({
        application_id: appId,
        campaign_id: liveId,
        creator_id: c1.id,
        platform: "tiktok",
        video_url: `https://example.com/oracle-${Date.now()}`,
        posted_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (subErr) throw subErr
    subId = sub.id
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown>) =>
    client.rpc(fn, args)

  // Nothing revealed = an error, null or false.
  const nothingRevealed = (r: { data: unknown; error: unknown }) =>
    r.error !== null || r.data === null || r.data === false || r.data === undefined

  it("control: the rightful owners get real answers", async () => {
    const a = await rpc(brand1.client, "can_manage_campaign", { target_campaign_id: liveId })
    expect(a.error).toBeNull()
    expect(a.data).toBe(true)

    const b = await rpc(brand1.client, "can_view_campaign", { target_campaign_id: draftId })
    expect(b.error).toBeNull()
    expect(b.data).toBe(true)

    const c = await rpc(c1.client, "can_view_submission", { target_submission_id: subId })
    expect(c.error).toBeNull()
    expect(c.data).toBe(true)

    const d = await rpc(brand1.client, "application_has_submissions", {
      target_application_id: appId,
    })
    expect(d.error).toBeNull()
    expect(d.data).toBe(true)

    const e = await rpc(brand1.client, "application_approved_at", {
      target_application_id: appId,
    })
    expect(e.error).toBeNull()
    expect(e.data).not.toBeNull()

    const f = await rpc(brand1.client, "brand_role", { target_brand_id: brand1Id })
    expect(f.error).toBeNull()
    expect(f.data).not.toBeNull()

    // The creator who owns the application must still get real answers.
    const g = await rpc(c1.client, "application_approved_at", {
      target_application_id: appId,
    })
    expect(g.error).toBeNull()
    expect(g.data).not.toBeNull()

    const h = await rpc(c1.client, "application_has_submissions", {
      target_application_id: appId,
    })
    expect(h.error).toBeNull()
    expect(h.data).toBe(true)

    const i = await rpc(brand1.client, "campaign_has_applications", {
      target_campaign_id: liveId,
    })
    expect(i.error).toBeNull()
    expect(i.data).toBe(true)
  })

  const attackers: [string, () => SupabaseClient][] = [
    ["an outsider creator", () => c2.client],
    ["the owner of a different brand", () => brand2.client],
    ["an anonymous visitor", () => createAnonClient()],
  ]

  for (const [who, getClient] of attackers) {
    it(`${who} learns nothing from the helper functions`, async () => {
      const client = getClient()
      const checks: [string, Record<string, unknown>][] = [
        ["can_view_campaign", { target_campaign_id: draftId }],
        ["can_manage_campaign", { target_campaign_id: liveId }],
        ["can_manage_campaign", { target_campaign_id: draftId }],
        ["can_view_submission", { target_submission_id: subId }],
        ["can_manage_submission", { target_submission_id: subId }],
        ["application_approved_at", { target_application_id: appId }],
        ["application_has_submissions", { target_application_id: appId }],
        ["campaign_has_applications", { target_campaign_id: liveId }],
        ["brand_role", { target_brand_id: brand1Id }],
        ["is_brand_member", { target_brand_id: brand1Id }],
        ["can_manage_brand", { target_brand_id: brand1Id }],
        ["shares_brand_with", { target_user_id: c1.id }],
        ["shares_brand_with", { target_user_id: brand1.id }],
      ]

      const leaks: string[] = []
      for (const [fn, args] of checks) {
        const result = await rpc(client, fn, args)
        if (!nothingRevealed(result)) {
          leaks.push(`${fn}(${JSON.stringify(args)}) -> ${JSON.stringify(result.data)}`)
        }
      }
      expect(leaks, `LEAKS:\n${leaks.join("\n")}`).toEqual([])
    })
  }

  it("an outsider cannot read a private draft campaign directly", async () => {
    const { data, error } = await c2.client.from("campaigns").select("id").eq("id", draftId)
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})