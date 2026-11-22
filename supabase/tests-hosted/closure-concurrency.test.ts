import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type RpcResult = { data: unknown; error: DbError }
type Wd = { withdrawal_id: string; reference: string; amount: number | string; destination: string; status: string }
type WdRow = { reference: string; status: string; amount: number | string }
type Accrual = { accrual_id: string; gross: number | string; status: string }

const BUDGET = 1_000_000

describe("closing, cancelling and withdrawals (concurrency and access)", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let other: TestUser
  let c1: TestUser
  let admin: TestUser
  let wb = ""
  let depositSeq = 0

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  async function fund(brand: string, amount: number) {
    const req = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: amount })
    if (req.error) throw req.error
    depositSeq += 1
    const conf = await rpc(service, "confirm_deposit", {
      p_reference: (req.data as { reference: string }[])[0].reference,
      p_provider_ref: `SEL-HCL-${run}-${depositSeq}`,
      p_amount: amount,
    })
    if (conf.error) throw conf.error
  }

  async function wallet(brand: string): Promise<number> {
    const r = await rpc(owner.client, "brand_wallet_summary", { p_brand_id: brand })
    if (r.error) throw r.error
    return Number(r.data)
  }

  async function balance(kind: string, who: { campaign?: string } = {}): Promise<number> {
    const id = await rpc(service, "ledger_ensure_account", {
      p_kind: kind,
      p_campaign_id: who.campaign ?? null,
    })
    if (id.error) throw id.error
    const b = await rpc(service, "ledger_balance", { p_account_id: id.data })
    if (b.error) throw b.error
    return Number(b.data)
  }

  async function draft(brand: string, title: string, deadline = "2026-12-31"): Promise<string> {
    const { data, error } = await owner.client
      .from("campaigns")
      .insert({
        title,
        brand_id: brand,
        status: "draft",
        platforms: ["tiktok"],
        rate_per_1k: 4000,
        budget: BUDGET,
        creators_needed: 2,
        videos_per_creator: 2,
        deadline,
      })
      .select("id")
      .single()
    if (error) throw error
    return data.id as string
  }

  async function liveCampaign(brand: string, title: string): Promise<string> {
    await fund(brand, BUDGET)
    const id = await draft(brand, title)
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
    const up = await owner.client.from("applications").update({ status: "approved" }).eq("id", data.id)
    if (up.error) throw up.error
    return data.id as string
  }

  const cancel = (client: SupabaseClient, campaignId: string) =>
    rpc(client, "cancel_campaign", { p_campaign_id: campaignId, p_reason: "stopping this campaign early" })

  const verify = (submissionId: string, views: number) =>
    Promise.resolve(
      admin.client
        .from("view_checkpoints")
        .update({ views, status: "verified", evidence_url: "https://example.com/evidence.png" })
        .eq("submission_id", submissionId)
        .select("id"),
    ) as Promise<RpcResult>

  async function accruals(campaignId: string): Promise<Accrual[]> {
    const r = await rpc(owner.client, "list_campaign_accruals", { p_campaign_id: campaignId })
    if (r.error) throw r.error
    return r.data as Accrual[]
  }

  const reqWd = async (client: SupabaseClient, brand: string, amount: number, dest = "0712345678") => {
    const r = await rpc(client, "request_brand_withdrawal", {
      p_brand_id: brand,
      p_amount: amount,
      p_destination: dest,
    })
    return { data: r.data as Wd[] | null, error: r.error }
  }

  const mustReqWd = async (amount: number): Promise<Wd> => {
    const r = await reqWd(owner.client, wb, amount)
    if (r.error) throw r.error
    return r.data![0]
  }

  const confirmWd = (reference: string, providerRef: string) =>
    rpc(service, "confirm_brand_withdrawal", { p_reference: reference, p_provider_ref: providerRef })

  const failWd = (reference: string) => rpc(service, "fail_brand_withdrawal", { p_reference: reference })

  async function myWds(client: SupabaseClient, brand: string): Promise<WdRow[]> {
    const r = await rpc(client, "list_brand_withdrawals", { p_brand_id: brand, p_limit: 200 })
    if (r.error) throw r.error
    return r.data as WdRow[]
  }

  async function integrityProblems(): Promise<string[]> {
    const r = await rpc(service, "ledger_integrity_report")
    if (r.error) throw r.error
    return (r.data as { check_name: string; ok: boolean; detail: string }[])
      .filter((row) => !row.ok)
      .map((row) => `${row.check_name}: ${row.detail}`)
  }

  beforeAll(async () => {
    service = createServiceClient()
    owner = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
    other = await ensureUser(service, "hosted-brand-owner-2@biboh.test", "brand")
    c1 = await ensureUser(service, "hosted-creator-1@biboh.test", "creator")
    admin = await ensureUser(service, "hosted-admin@biboh.test", "admin")
    await ensureCreatorRow(c1.client)

    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id)
    if (promoted.error) throw promoted.error

    wb = await createBrand(owner.client, `hosted-test-closing-wallet-${run}`)
    await fund(wb, 500_000)
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("cancelling the same campaign twice at once returns the budget once", async () => {
    const brand = await createBrand(owner.client, `hosted-test-closing-dbl-${run}`)
    const campaign = await liveCampaign(brand, `hosted-test-closing-dbl-${run}`)

    const results = await Promise.all([cancel(owner.client, campaign), cancel(owner.client, campaign)])
    for (const r of results) {
      expect(r.error, JSON.stringify(r.error)).toBeNull()
      expect(r.data).toBe("cancelled")
    }

    expect(await wallet(brand)).toBe(BUDGET)
    expect(await balance("campaign_escrow", { campaign })).toBe(0)
  })

  for (let round = 0; round < 6; round++) {
    it(`round ${round}: cancelling while a creator posts never strands the payout`, async () => {
      const brand = await createBrand(owner.client, `hosted-test-closing-race-${run}-${round}`)
      const campaign = await liveCampaign(brand, `hosted-test-closing-race-${run}-${round}`)
      const application = await approved(campaign, c1)

      const [cancelled, posted] = await Promise.all([
        cancel(owner.client, campaign),
        Promise.resolve(
          service
            .from("submissions")
            .insert({
              application_id: application,
              campaign_id: campaign,
              creator_id: c1.id,
              platform: "tiktok",
              video_url: `https://example.com/hcl-${run}-${round}`,
              posted_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
            })
            .select("id")
            .single(),
        ) as Promise<{ data: { id: string } | null; error: DbError }>,
      ])

      expect(cancelled.error, JSON.stringify(cancelled.error)).toBeNull()

      if (posted.error) {
        // The cancel won: the video was refused and everything came back.
        expect(posted.error.code).toBe("23514")
        expect(posted.error.message ?? "").toContain("campaign must be live")
        expect(await balance("campaign_escrow", { campaign })).toBe(0)
        expect(await wallet(brand)).toBe(BUDGET)
      } else {
        // The video was accepted: the money must still be in escrow to pay it.
        expect(await balance("campaign_escrow", { campaign })).toBe(BUDGET)
        expect(await wallet(brand)).toBe(0)

        const verified = await verify(posted.data!.id, 10_000)
        expect(verified.error, JSON.stringify(verified.error)).toBeNull()
        const rows = await accruals(campaign)
        expect(rows).toHaveLength(1)
        expect(Number(rows[0].gross)).toBe(40_000)
      }
    })
  }

  it("the close job run twice at once returns an expired campaign's budget once", async () => {
    const brand = await createBrand(owner.client, `hosted-test-closing-job-${run}`)
    await fund(brand, BUDGET)
    const campaign = await draft(brand, `hosted-test-closing-job-${run}`, "2026-01-01")
    const published = await rpc(owner.client, "publish_campaign", { p_campaign_id: campaign })
    expect(published.error, JSON.stringify(published.error)).toBeNull()
    expect(await wallet(brand)).toBe(0)

    const results = await Promise.all([rpc(service, "close_due_campaigns"), rpc(service, "close_due_campaigns")])
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()

    expect(await wallet(brand)).toBe(BUDGET)
    expect(await balance("campaign_escrow", { campaign })).toBe(0)
    const state = await service.from("campaigns").select("status").eq("id", campaign).single()
    if (state.error) throw state.error
    expect(state.data.status).toBe("completed")
  })

  it("a withdrawal is recorded once however often Selcom confirms it", async () => {
    const walletBefore = await wallet(wb)
    const selcomBefore = await balance("selcom_holdings")
    const transitBefore = await balance("payout_in_transit")

    const w = await mustReqWd(5_000)
    expect(w.reference).toMatch(/^BW[0-9A-F]{16}$/)
    expect(await wallet(wb)).toBe(walletBefore - 5_000)

    const providerRef = `SEL-HCL-${run}-A`
    const results = await Promise.all(Array.from({ length: 8 }, () => confirmWd(w.reference, providerRef)))
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(new Set(results.map((r) => r.data)).size).toBe(1)

    expect(await balance("selcom_holdings")).toBe(selcomBefore - 5_000)
    expect(await balance("payout_in_transit")).toBe(transitBefore)
  })

  it("two withdrawals for the whole wallet at once: exactly one wins", async () => {
    const whole = await wallet(wb)
    expect(whole).toBeGreaterThanOrEqual(1_000)

    const results = await Promise.all([reqWd(owner.client, wb, whole), reqWd(owner.client, wb, whole)])
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe("23514")
    expect(losers[0].error!.message ?? "").toContain("insufficient wallet balance")
    expect(await wallet(wb)).toBe(0)

    const failed = await failWd(winners[0].data![0].reference)
    expect(failed.error).toBeNull()
    expect(await wallet(wb)).toBe(whole)
  })

  for (let round = 0; round < 3; round++) {
    it(`round ${round}: a withdrawal confirmation racing a failure leaves honest books`, async () => {
      const w = await mustReqWd(1_000)
      const before = {
        wallet: await wallet(wb),
        transit: await balance("payout_in_transit"),
        selcom: await balance("selcom_holdings"),
      }

      const [conf, fail] = await Promise.all([
        confirmWd(w.reference, `SEL-HCL-${run}-R${round}`),
        failWd(w.reference),
      ])
      const status = (await myWds(owner.client, wb)).find((x) => x.reference === w.reference)?.status
      expect(["confirmed", "failed"]).toContain(status)

      if (status === "confirmed") {
        expect(conf.error, JSON.stringify(conf.error)).toBeNull()
        expect(fail.error!.code).toBe("23514")
        expect(fail.error!.message ?? "").toContain("confirmed withdrawal cannot be failed")
        expect(await wallet(wb)).toBe(before.wallet)
        expect(await balance("selcom_holdings")).toBe(before.selcom - 1_000)
      } else {
        expect(fail.error, JSON.stringify(fail.error)).toBeNull()
        expect(conf.error!.code).toBe("23514")
        expect(conf.error!.message ?? "").toContain("marked failed")
        expect(await wallet(wb)).toBe(before.wallet + 1_000)
        expect(await balance("selcom_holdings")).toBe(before.selcom)
      }
      expect(await balance("payout_in_transit")).toBe(before.transit - 1_000)
    })
  }

  it("eight withdrawals at once: no more than five can be open", async () => {
    const walletBefore = await wallet(wb)
    const openBefore = (await myWds(owner.client, wb)).filter((w) => w.status === "requested").length

    const results = await Promise.all(Array.from({ length: 8 }, () => reqWd(owner.client, wb, 1_000)))
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)

    expect(winners).toHaveLength(5 - openBefore)
    expect(losers).toHaveLength(8 - (5 - openBefore))
    for (const r of losers) {
      expect(r.error!.code).toBe("23514")
      expect(r.error!.message ?? "").toContain("too many open withdrawals")
    }

    for (const w of (await myWds(owner.client, wb)).filter((x) => x.status === "requested")) {
      const f = await failWd(w.reference)
      expect(f.error, JSON.stringify(f.error)).toBeNull()
    }
    expect(await wallet(wb)).toBe(walletBefore)
  })

  it("only the brand owner can withdraw, and nobody outside can settle or close", async () => {
    const walletBefore = await wallet(wb)

    for (const [who, client] of [
      ["another brand's owner", other.client],
      ["a creator", c1.client],
    ] as [string, SupabaseClient][]) {
      const r = await reqWd(client, wb, 5_000)
      expect(r.error, `${who} was allowed to withdraw`).not.toBeNull()
      expect(r.error!.code).toBe("42501")
      expect(r.error!.message ?? "").toContain("only the brand owner")
    }
    const visitor = await reqWd(createAnonClient(), wb, 5_000)
    expect(visitor.error).not.toBeNull()
    expect(["42501", "PGRST202"]).toContain(visitor.error!.code)

    const w = await mustReqWd(1_000)
    const callers: [string, SupabaseClient][] = [
      ["a visitor", createAnonClient()],
      ["the brand owner", owner.client],
      ["another brand's owner", other.client],
      ["a creator", c1.client],
    ]
    for (const [who, client] of callers) {
      const attempts = await Promise.all([
        rpc(client, "confirm_brand_withdrawal", { p_reference: w.reference, p_provider_ref: `SEL-ATTACK-${run}` }),
        rpc(client, "fail_brand_withdrawal", { p_reference: w.reference }),
        rpc(client, "close_due_campaigns"),
      ])
      for (const r of attempts) {
        expect(r.error, `${who} was allowed to call a server function`).not.toBeNull()
        expect(["42501", "PGRST202"]).toContain(r.error!.code)
      }
    }

    const brand = await createBrand(owner.client, `hosted-test-closing-acl-${run}`)
    const campaign = await liveCampaign(brand, `hosted-test-closing-acl-${run}`)
    for (const [who, client] of [
      ["another brand's owner", other.client],
      ["a creator", c1.client],
      ["a visitor", createAnonClient()],
    ] as [string, SupabaseClient][]) {
      const r = await cancel(client, campaign)
      expect(r.error, `${who} was allowed to cancel`).not.toBeNull()
      expect(["42501", "PGRST202"]).toContain(r.error!.code)
    }
    const state = await service.from("campaigns").select("status").eq("id", campaign).single()
    if (state.error) throw state.error
    expect(state.data.status).toBe("live")

    const failed = await failWd(w.reference)
    expect(failed.error).toBeNull()
    expect(await wallet(wb)).toBe(walletBefore)
  })

  it("only the brand's own members see its withdrawals", async () => {
    expect((await myWds(owner.client, wb)).length).toBeGreaterThan(0)

    for (const [who, client] of [
      ["another brand's owner", other.client],
      ["a creator", c1.client],
      ["a visitor", createAnonClient()],
    ] as [string, SupabaseClient][]) {
      const r = await rpc(client, "list_brand_withdrawals", { p_brand_id: wb })
      expect(r.error, `${who} could read the withdrawals`).not.toBeNull()
      expect(["42501", "PGRST202"]).toContain(r.error!.code)
    }
  })

  it("finishes with a clean integrity report", async () => {
    expect(await integrityProblems()).toEqual([])
  })
})