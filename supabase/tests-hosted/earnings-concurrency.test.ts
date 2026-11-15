import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type RpcResult = { data: unknown; error: DbError }
type Accrual = {
  accrual_id: string
  creator_id: string
  views: number | string
  gross: number | string
  fee: number | string
  net: number | string
  status: string
}
type Earning = { accrual_id: string; campaign_id: string; net: number | string; status: string }

const BUDGET = 1_000_000

describe("funding and earnings (concurrency and access)", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let other: TestUser
  let c1: TestUser
  let c2: TestUser
  let admin: TestUser
  let depositSeq = 0

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  async function fund(brand: string, amount: number) {
    const req = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: amount })
    if (req.error) throw req.error
    const reference = (req.data as { reference: string }[])[0].reference
    depositSeq += 1
    const conf = await rpc(service, "confirm_deposit", {
      p_reference: reference,
      p_provider_ref: `SEL-HL-${run}-${depositSeq}`,
      p_amount: amount,
    })
    if (conf.error) throw conf.error
  }

  async function wallet(brand: string): Promise<number> {
    const r = await rpc(owner.client, "brand_wallet_summary", { p_brand_id: brand })
    if (r.error) throw r.error
    return Number(r.data)
  }

  async function balance(
    kind: string,
    who: { campaign?: string; creator?: string } = {},
  ): Promise<number> {
    const id = await rpc(service, "ledger_ensure_account", {
      p_kind: kind,
      p_campaign_id: who.campaign ?? null,
      p_creator_id: who.creator ?? null,
    })
    if (id.error) throw id.error
    const b = await rpc(service, "ledger_balance", { p_account_id: id.data })
    if (b.error) throw b.error
    return Number(b.data)
  }

  async function draft(
    brand: string,
    title: string,
    o: { budget?: number; creators?: number; rate?: number; videos?: number } = {},
  ): Promise<string> {
    const { data, error } = await owner.client
      .from("campaigns")
      .insert({
        title,
        brand_id: brand,
        status: "draft",
        platforms: ["tiktok"],
        rate_per_1k: o.rate ?? 4000,
        budget: o.budget ?? BUDGET,
        creators_needed: o.creators ?? 2,
        videos_per_creator: o.videos ?? 2,
        deadline: "2026-12-31",
      })
      .select("id")
      .single()
    if (error) throw error
    return data.id as string
  }

  async function liveCampaign(
    brand: string,
    title: string,
    o: { budget?: number; creators?: number; rate?: number; videos?: number } = {},
  ): Promise<string> {
    const budget = o.budget ?? BUDGET
    await fund(brand, budget)
    const id = await draft(brand, title, { ...o, budget })
    const r = await rpc(owner.client, "publish_campaign", { p_campaign_id: id })
    if (r.error) throw r.error
    return id
  }

  async function approved(campaignId: string, creator: TestUser): Promise<string> {
    const { data, error } = await creator.client
      .from("applications")
      .insert({ campaign_id: campaignId, creator_id: creator.id })
      .select("id")
      .single()
    if (error) throw error
    const up = await owner.client
      .from("applications")
      .update({ status: "approved" })
      .eq("id", data.id)
    if (up.error) throw up.error
    return data.id as string
  }

  async function video(applicationId: string, campaignId: string, creator: TestUser): Promise<string> {
    const { data, error } = await service
      .from("submissions")
      .insert({
        application_id: applicationId,
        campaign_id: campaignId,
        creator_id: creator.id,
        platform: "tiktok",
        video_url: `https://example.com/hl-${run}-${Math.random().toString(36).slice(2)}`,
        posted_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      })
      .select("id")
      .single()
    if (error) throw error
    return data.id as string
  }

  const verify = (submissionId: string, views: number) =>
    Promise.resolve(
      admin.client
        .from("view_checkpoints")
        .update({ views, status: "verified", evidence_url: "https://example.com/evidence.png" })
        .eq("submission_id", submissionId)
        .select("id, status"),
    ) as Promise<RpcResult>

  async function accruals(campaignId: string): Promise<Accrual[]> {
    const r = await rpc(owner.client, "list_campaign_accruals", { p_campaign_id: campaignId })
    if (r.error) throw r.error
    return r.data as Accrual[]
  }

  async function earnings(client: SupabaseClient): Promise<Earning[]> {
    const r = await rpc(client, "list_my_earnings")
    if (r.error) throw r.error
    return r.data as Earning[]
  }

  async function integrityProblems(): Promise<string[]> {
    const r = await rpc(service, "ledger_integrity_report")
    if (r.error) throw r.error
    return (r.data as { check_name: string; ok: boolean; detail: string }[])
      .filter((row) => !row.ok)
      .map((row) => `${row.check_name}: ${row.detail}`)
  }

  const none = (n: number) => `${n}`

  beforeAll(async () => {
    service = createServiceClient()
    owner = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
    other = await ensureUser(service, "hosted-brand-owner-2@biboh.test", "brand")
    c1 = await ensureUser(service, "hosted-creator-1@biboh.test", "creator")
    c2 = await ensureUser(service, "hosted-creator-2@biboh.test", "creator")
    admin = await ensureUser(service, "hosted-admin@biboh.test", "admin")

    await ensureCreatorRow(c1.client)
    await ensureCreatorRow(c2.client)

    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id)
    if (promoted.error) throw promoted.error
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("publishing the same campaign twice at once charges the wallet once", async () => {
    const brand = await createBrand(owner.client, `hosted-test-ledger-dbl-${run}`)
    await fund(brand, 2 * BUDGET)
    const id = await draft(brand, `hosted-test-ledger-dbl-${run}`)

    const results = await Promise.all([
      rpc(owner.client, "publish_campaign", { p_campaign_id: id }),
      rpc(owner.client, "publish_campaign", { p_campaign_id: id }),
    ])
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe("23514")
    expect(losers[0].error!.message ?? "").toMatch(/only a draft campaign|already funded/)

    expect(await wallet(brand)).toBe(BUDGET)
    expect(await balance("campaign_escrow", { campaign: id })).toBe(BUDGET)
  })

  for (let round = 0; round < 3; round++) {
    it(`round ${round}: two campaigns racing for one wallet balance, only one is funded`, async () => {
      const brand = await createBrand(owner.client, `hosted-test-ledger-race-${run}-${round}`)
      await fund(brand, BUDGET)
      const a = await draft(brand, `hosted-test-ledger-race-a-${run}-${round}`)
      const b = await draft(brand, `hosted-test-ledger-race-b-${run}-${round}`)

      const results = await Promise.all([
        rpc(owner.client, "publish_campaign", { p_campaign_id: a }),
        rpc(owner.client, "publish_campaign", { p_campaign_id: b }),
      ])
      const winners = results.filter((r) => !r.error)
      const losers = results.filter((r) => r.error)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect(losers[0].error!.code).toBe("23514")
      expect(losers[0].error!.message ?? "").toMatch(/insufficient wallet balance|accounts_balance_check/)

      expect(await wallet(brand)).toBe(0)

      const states = await service.from("campaigns").select("id, status").in("id", [a, b])
      if (states.error) throw states.error
      const live = (states.data ?? []).filter((s) => s.status === "live")
      const drafts = (states.data ?? []).filter((s) => s.status === "draft")
      expect(live).toHaveLength(1)
      expect(drafts).toHaveLength(1)
      expect(await balance("campaign_escrow", { campaign: live[0].id as string })).toBe(BUDGET)

      await service.from("campaigns").delete().eq("id", drafts[0].id)
    })
  }

  for (let round = 0; round < 3; round++) {
    it(`round ${round}: two videos from one creator verified at once share the cap`, async () => {
      const brand = await createBrand(owner.client, `hosted-test-ledger-cap-${run}-${round}`)
      const campaign = await liveCampaign(brand, `hosted-test-ledger-cap-${run}-${round}`)
      const application = await approved(campaign, c1)
      const first = await video(application, campaign, c1)
      const second = await video(application, campaign, c1)

      const results = await Promise.all([verify(first, 100_000), verify(second, 100_000)])
      for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()

      const rows = await accruals(campaign)
      expect(rows).toHaveLength(2)
      const gross = rows.map((r) => Number(r.gross)).sort((x, y) => x - y)
      expect(gross).toEqual([100_000, 400_000])
      expect(await balance("campaign_escrow", { campaign })).toBe(BUDGET - 500_000)
    })
  }

  it("verifying the same checkpoint twice at once pays once", async () => {
    const brand = await createBrand(owner.client, `hosted-test-ledger-twice-${run}`)
    const campaign = await liveCampaign(brand, `hosted-test-ledger-twice-${run}`)
    const application = await approved(campaign, c1)
    const vid = await video(application, campaign, c1)

    const results = await Promise.all([verify(vid, 10_000), verify(vid, 10_000)])
    expect(results.some((r) => !r.error)).toBe(true)

    const rows = await accruals(campaign)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].gross)).toBe(40_000)
    expect(await balance("campaign_escrow", { campaign })).toBe(BUDGET - 40_000)
  })

  it("the release job run twice at once credits each payout once", async () => {
    const original = await service.from("platform_settings").select("review_hours").eq("id", true).single()
    if (original.error) throw original.error
    const originalHours = Number(original.data.review_hours)

    const setHours = async (hours: number) => {
      const r = await service.from("platform_settings").update({ review_hours: hours }).eq("id", true)
      if (r.error) throw r.error
    }

    const brand = await createBrand(owner.client, `hosted-test-ledger-rel-${run}`)
    let campaign = ""
    try {
      // The campaign copies this setting when it launches, so its payouts are due at once.
      await setHours(0)
      campaign = await liveCampaign(brand, `hosted-test-ledger-rel-${run}`)
    } finally {
      await setHours(originalHours)
    }

    const application = await approved(campaign, c2)
    const vid = await video(application, campaign, c2)
    const verified = await verify(vid, 10_000)
    expect(verified.error, JSON.stringify(verified.error)).toBeNull()

    const before = await earnings(c2.client)
    const ours = before.find((e) => e.campaign_id === campaign)
    expect(ours?.status).toBe("held")
    const payableBefore = await balance("creator_payable", { creator: c2.id })

    const results = await Promise.all([rpc(service, "release_due_accruals"), rpc(service, "release_due_accruals")])
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()

    const after = await earnings(c2.client)
    expect(after.find((e) => e.campaign_id === campaign)?.status).toBe("released")

    // Whatever was held before and released now must have been credited exactly once.
    const beforeHeld = new Map(before.filter((e) => e.status === "held").map((e) => [e.accrual_id, e]))
    const releasedNow = after.filter((e) => e.status === "released" && beforeHeld.has(e.accrual_id))
    const expected = releasedNow.reduce((sum, e) => sum + Number(e.net), 0)
    expect(expected).toBeGreaterThan(0)
    expect(await balance("creator_payable", { creator: c2.id })).toBe(payableBefore + expected)
    expect(await integrityProblems()).toEqual([])
  })

  it("a flagged payout reversed by an admin puts the money back", async () => {
    const brand = await createBrand(owner.client, `hosted-test-ledger-flag-${run}`)
    const campaign = await liveCampaign(brand, `hosted-test-ledger-flag-${run}`)
    const application = await approved(campaign, c1)
    const vid = await video(application, campaign, c1)

    const before = {
      escrow: await balance("campaign_escrow", { campaign }),
      pending: await balance("creator_pending", { creator: c1.id }),
      fees: await balance("platform_fees"),
    }

    const verified = await verify(vid, 10_000)
    expect(verified.error, JSON.stringify(verified.error)).toBeNull()
    const [accrual] = await accruals(campaign)
    expect(accrual.status).toBe("held")
    expect(Number(accrual.gross)).toBe(40_000)
    expect(await balance("campaign_escrow", { campaign })).toBe(before.escrow - 40_000)

    const flagged = await rpc(owner.client, "flag_accrual", {
      p_accrual_id: accrual.accrual_id,
      p_reason: "views look inflated by bots",
    })
    expect(flagged.error, JSON.stringify(flagged.error)).toBeNull()
    expect(flagged.data).toBe("flagged")

    const brandTries = await rpc(owner.client, "resolve_accrual_flag", {
      p_accrual_id: accrual.accrual_id,
      p_decision: "reverse",
      p_note: "the brand cannot decide its own flag",
    })
    expect(brandTries.error).not.toBeNull()
    expect(brandTries.error!.code).toBe("42501")

    const decided = await rpc(admin.client, "resolve_accrual_flag", {
      p_accrual_id: accrual.accrual_id,
      p_decision: "reverse",
      p_note: "evidence shows the views were bought",
    })
    expect(decided.error, JSON.stringify(decided.error)).toBeNull()
    expect(decided.data).toBe("reversed")

    expect(await balance("campaign_escrow", { campaign })).toBe(before.escrow)
    expect(await balance("creator_pending", { creator: c1.id })).toBe(before.pending)
    expect(await balance("platform_fees")).toBe(before.fees)
    expect((await accruals(campaign))[0].status).toBe("reversed")
  })

  it("outsiders and visitors are refused everything", async () => {
    const brand = await createBrand(owner.client, `hosted-test-ledger-acl-${run}`)
    const campaign = await liveCampaign(brand, `hosted-test-ledger-acl-${run}`)
    const application = await approved(campaign, c1)
    const vid = await video(application, campaign, c1)
    const verified = await verify(vid, 10_000)
    expect(verified.error, JSON.stringify(verified.error)).toBeNull()
    const [accrual] = await accruals(campaign)

    await fund(brand, BUDGET)
    const spare = await draft(brand, `hosted-test-ledger-acl-spare-${run}`)

    const callers: [string, SupabaseClient][] = [
      ["another brand's owner", other.client],
      ["a creator who is not the earner", c2.client],
      ["a visitor", createAnonClient()],
    ]

    for (const [who, client] of callers) {
      const attempts: [string, RpcResult][] = [
        ["publish", await rpc(client, "publish_campaign", { p_campaign_id: spare })],
        ["list payouts", await rpc(client, "list_campaign_accruals", { p_campaign_id: campaign })],
        ["flag", await rpc(client, "flag_accrual", { p_accrual_id: accrual.accrual_id, p_reason: "an outsider's flag attempt" })],
        [
          "resolve",
          await rpc(client, "resolve_accrual_flag", {
            p_accrual_id: accrual.accrual_id,
            p_decision: "reverse",
            p_note: "an outsider's resolve attempt",
          }),
        ],
        ["release job", await rpc(client, "release_due_accruals")],
      ]
      for (const [what, r] of attempts) {
        expect(r.error, `${who} was allowed to ${what}`).not.toBeNull()
        expect(["42501", "PGRST202"]).toContain(r.error!.code)
      }
    }

    // The earner and the brand's own team still cannot do what is admin-only or server-only.
    const earnerFlag = await rpc(c1.client, "flag_accrual", {
      p_accrual_id: accrual.accrual_id,
      p_reason: "the earner is not a manager",
    })
    expect(earnerFlag.error).not.toBeNull()
    const ownerRelease = await rpc(owner.client, "release_due_accruals")
    expect(ownerRelease.error).not.toBeNull()

    const visitorEarnings = await rpc(createAnonClient(), "list_my_earnings")
    expect(visitorEarnings.error).not.toBeNull()

    const state = await service.from("campaigns").select("status").eq("id", spare).single()
    if (state.error) throw state.error
    expect(state.data.status).toBe("draft")
    expect((await accruals(campaign))[0].status).toBe("held")
  })

  it("finishes with a clean integrity report", async () => {
    expect(await integrityProblems()).toEqual([])
    void none
  })
})