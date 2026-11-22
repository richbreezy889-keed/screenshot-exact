import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type RpcResult = { data: unknown; error: DbError }
type Req = { payout_id: string; reference: string; amount: number | string; destination: string; status: string }
type Row = { reference: string; status: string; amount: number | string }

const BUDGET = 1_000_000

describe("creator payouts (concurrency and access)", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let other: TestUser
  let c1: TestUser
  let c2: TestUser
  let admin: TestUser
  let depositSeq = 0
  let firstRef = ""

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  async function balance(kind: string, creatorId?: string): Promise<number> {
    const id = await rpc(service, "ledger_ensure_account", {
      p_kind: kind,
      p_creator_id: creatorId ?? null,
    })
    if (id.error) throw id.error
    const b = await rpc(service, "ledger_balance", { p_account_id: id.data })
    if (b.error) throw b.error
    return Number(b.data)
  }

  async function request(client: SupabaseClient, amount: number, destination = "0712345678") {
    const r = await rpc(client, "request_payout", { p_amount: amount, p_destination: destination })
    return { data: r.data as Req[] | null, error: r.error }
  }

  async function mustRequest(client: SupabaseClient, amount: number, destination = "0712345678"): Promise<Req> {
    const r = await request(client, amount, destination)
    if (r.error) throw r.error
    return r.data![0]
  }

  const confirmPayout = (reference: string, providerRef: string) =>
    rpc(service, "confirm_payout", { p_reference: reference, p_provider_ref: providerRef })

  const failPayout = (reference: string) => rpc(service, "fail_payout", { p_reference: reference })

  async function myPayouts(client: SupabaseClient): Promise<Row[]> {
    const r = await rpc(client, "list_my_payouts", { p_limit: 200 })
    if (r.error) throw r.error
    return r.data as Row[]
  }

  async function statusOf(client: SupabaseClient, reference: string): Promise<string | undefined> {
    return (await myPayouts(client)).find((p) => p.reference === reference)?.status
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
    c2 = await ensureUser(service, "hosted-creator-2@biboh.test", "creator")
    admin = await ensureUser(service, "hosted-admin@biboh.test", "admin")
    await ensureCreatorRow(c1.client)
    await ensureCreatorRow(c2.client)

    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id)
    if (promoted.error) throw promoted.error

    const original = await service.from("platform_settings").select("review_hours").eq("id", true).single()
    if (original.error) throw original.error
    const originalHours = Number(original.data.review_hours)
    const setHours = async (hours: number) => {
      const r = await service.from("platform_settings").update({ review_hours: hours }).eq("id", true)
      if (r.error) throw r.error
    }

    const brand = await createBrand(owner.client, `hosted-test-payouts-${run}`)
    let campaign = ""
    try {
      // The campaign copies this setting when it launches, so its earnings are due at once.
      await setHours(0)

      const req = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: BUDGET })
      if (req.error) throw req.error
      depositSeq += 1
      const conf = await rpc(service, "confirm_deposit", {
        p_reference: (req.data as { reference: string }[])[0].reference,
        p_provider_ref: `SEL-HPO-SETUP-${run}-${depositSeq}`,
        p_amount: BUDGET,
      })
      if (conf.error) throw conf.error

      const created = await owner.client
        .from("campaigns")
        .insert({
          title: `hosted-test-payouts-${run}`,
          brand_id: brand,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: BUDGET,
          creators_needed: 2,
          videos_per_creator: 1,
          deadline: "2026-12-31",
        })
        .select("id")
        .single()
      if (created.error) throw created.error
      campaign = created.data.id as string

      const pub = await rpc(owner.client, "publish_campaign", { p_campaign_id: campaign })
      if (pub.error) throw pub.error
    } finally {
      await setHours(originalHours)
    }

    for (const creator of [c1, c2]) {
      const app = await creator.client
        .from("applications")
        .insert({ campaign_id: campaign, creator_id: creator.id })
        .select("id")
        .single()
      if (app.error) throw app.error

      const ok = await owner.client.from("applications").update({ status: "approved" }).eq("id", app.data.id)
      if (ok.error) throw ok.error

      const vid = await service
        .from("submissions")
        .insert({
          application_id: app.data.id,
          campaign_id: campaign,
          creator_id: creator.id,
          platform: "tiktok",
          video_url: `https://example.com/hpo-${run}-${creator.id}`,
          posted_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
        })
        .select("id")
        .single()
      if (vid.error) throw vid.error

      const verified = await admin.client
        .from("view_checkpoints")
        .update({ views: 100_000, status: "verified", evidence_url: "https://example.com/evidence.png" })
        .eq("submission_id", vid.data.id)
        .select("id")
      if (verified.error) throw verified.error
    }

    const released = await rpc(service, "release_due_accruals")
    if (released.error) throw released.error

    expect(await balance("creator_payable", c1.id)).toBeGreaterThanOrEqual(300_000)
    expect(await balance("creator_payable", c2.id)).toBeGreaterThanOrEqual(300_000)
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("a request moves the amount to in transit and stores the number in one format", async () => {
    const payableBefore = await balance("creator_payable", c1.id)
    const transitBefore = await balance("payout_in_transit")

    const p = await mustRequest(c1.client, 5_000, "+255 712 345 678")
    firstRef = p.reference

    expect(p.reference).toMatch(/^PO[0-9A-F]{16}$/)
    expect(p.destination).toBe("255712345678")
    expect(p.status).toBe("requested")
    expect(await balance("creator_payable", c1.id)).toBe(payableBefore - 5_000)
    expect(await balance("payout_in_transit")).toBe(transitBefore + 5_000)
  })

  it("the same Selcom confirmation delivered 8 times at once settles once", async () => {
    const selcomBefore = await balance("selcom_holdings")
    const transitBefore = await balance("payout_in_transit")
    const providerRef = `SEL-HPO-${run}-A`

    const results = await Promise.all(Array.from({ length: 8 }, () => confirmPayout(firstRef, providerRef)))
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(new Set(results.map((r) => r.data)).size).toBe(1)

    expect(await balance("selcom_holdings")).toBe(selcomBefore - 5_000)
    expect(await balance("payout_in_transit")).toBe(transitBefore - 5_000)
    expect(await statusOf(c1.client, firstRef)).toBe("confirmed")
  })

  it("two requests for the whole balance at once: exactly one wins", async () => {
    const whole = await balance("creator_payable", c1.id)
    expect(whole).toBeGreaterThanOrEqual(1_000)
    const transitBefore = await balance("payout_in_transit")

    const results = await Promise.all([request(c1.client, whole), request(c1.client, whole)])
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe("23514")
    expect(losers[0].error!.message ?? "").toContain("insufficient payable balance")

    expect(await balance("creator_payable", c1.id)).toBe(0)
    expect(await balance("payout_in_transit")).toBe(transitBefore + whole)

    // Put the money back so later tests have a balance to use.
    const failed = await failPayout(winners[0].data![0].reference)
    expect(failed.error).toBeNull()
    expect(await balance("creator_payable", c1.id)).toBe(whole)
  })

  it("eight requests at once: no more than five payouts can be open", async () => {
    const payableBefore = await balance("creator_payable", c2.id)
    expect(payableBefore).toBeGreaterThanOrEqual(8_000)
    const openBefore = (await myPayouts(c2.client)).filter((p) => p.status === "requested").length

    const results = await Promise.all(Array.from({ length: 8 }, () => request(c2.client, 1_000)))
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)

    expect(winners).toHaveLength(5 - openBefore)
    expect(losers).toHaveLength(8 - (5 - openBefore))
    for (const r of losers) {
      expect(r.error!.code).toBe("23514")
      expect(r.error!.message ?? "").toContain("too many open payouts")
    }
    expect(new Set(winners.map((r) => r.data![0].reference)).size).toBe(winners.length)

    // Close them all so the next tests start clean.
    const open = (await myPayouts(c2.client)).filter((p) => p.status === "requested")
    for (const p of open) {
      const f = await failPayout(p.reference)
      expect(f.error, JSON.stringify(f.error)).toBeNull()
    }
    expect(await balance("creator_payable", c2.id)).toBe(payableBefore)
  })

  for (let round = 0; round < 4; round++) {
    it(`round ${round}: a confirmation racing a failure leaves one outcome and honest books`, async () => {
      const p = await mustRequest(c2.client, 1_000)
      const before = {
        payable: await balance("creator_payable", c2.id),
        transit: await balance("payout_in_transit"),
        selcom: await balance("selcom_holdings"),
      }

      const [conf, fail] = await Promise.all([
        confirmPayout(p.reference, `SEL-HPO-${run}-R${round}`),
        failPayout(p.reference),
      ])
      const status = await statusOf(c2.client, p.reference)
      expect(["confirmed", "failed"]).toContain(status)

      if (status === "confirmed") {
        expect(conf.error, JSON.stringify(conf.error)).toBeNull()
        expect(fail.error).not.toBeNull()
        expect(fail.error!.code).toBe("23514")
        expect(fail.error!.message ?? "").toContain("confirmed payout cannot be failed")
        expect(await balance("creator_payable", c2.id)).toBe(before.payable)
        expect(await balance("selcom_holdings")).toBe(before.selcom - 1_000)
      } else {
        expect(fail.error, JSON.stringify(fail.error)).toBeNull()
        expect(conf.error).not.toBeNull()
        expect(conf.error!.code).toBe("23514")
        expect(conf.error!.message ?? "").toContain("marked failed")
        expect(await balance("creator_payable", c2.id)).toBe(before.payable + 1_000)
        expect(await balance("selcom_holdings")).toBe(before.selcom)
      }
      expect(await balance("payout_in_transit")).toBe(before.transit - 1_000)
    })
  }

  it("one Selcom payment cannot settle two payouts at once", async () => {
    const p1 = await mustRequest(c2.client, 1_000)
    const p2 = await mustRequest(c2.client, 1_000)
    const selcomBefore = await balance("selcom_holdings")
    const payableBefore = await balance("creator_payable", c2.id)
    const providerRef = `SEL-HPO-${run}-DUP`

    const results = await Promise.all([confirmPayout(p1.reference, providerRef), confirmPayout(p2.reference, providerRef)])
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe("23505")

    expect(await balance("selcom_holdings")).toBe(selcomBefore - 1_000)

    const loserRef = results[0].error ? p1.reference : p2.reference
    expect(await statusOf(c2.client, loserRef)).toBe("requested")
    const failed = await failPayout(loserRef)
    expect(failed.error).toBeNull()
    expect(await balance("creator_payable", c2.id)).toBe(payableBefore + 1_000)
  })

  it("invalid requests are refused and create nothing", async () => {
    const before = (await myPayouts(c1.client)).length

    const tooSmall = await request(c1.client, 999)
    expect(tooSmall.error!.code).toBe("23514")
    expect(tooSmall.error!.message ?? "").toContain("payout amount must be between")

    const tooMuch = await request(c1.client, 49_999_999)
    expect(tooMuch.error!.code).toBe("23514")
    expect(tooMuch.error!.message ?? "").toContain("insufficient payable balance")

    for (const bad of ["12345", "0512345678", "+254712345678"]) {
      const r = await request(c1.client, 5_000, bad)
      expect(r.error!.code).toBe("23514")
      expect(r.error!.message ?? "").toContain("valid Tanzanian mobile number")
    }

    expect((await myPayouts(c1.client)).length).toBe(before)
  })

  it("outsiders and visitors cannot request, settle or read payouts", async () => {
    const payableBefore = await balance("creator_payable", c1.id)

    for (const [who, client] of [
      ["a brand owner", owner.client],
      ["another brand's owner", other.client],
    ] as [string, SupabaseClient][]) {
      const r = await request(client, 5_000)
      expect(r.error, `${who} was allowed to request a payout`).not.toBeNull()
      expect(r.error!.code).toBe("42501")
      expect(r.error!.message ?? "").toContain("only creator accounts")
    }

    const visitor = await request(createAnonClient(), 5_000)
    expect(visitor.error).not.toBeNull()
    expect(["42501", "PGRST202"]).toContain(visitor.error!.code)

    const p = await mustRequest(c1.client, 1_000)
    const callers: [string, SupabaseClient][] = [
      ["a visitor", createAnonClient()],
      ["the earner", c1.client],
      ["another creator", c2.client],
      ["a brand owner", owner.client],
    ]
    for (const [who, client] of callers) {
      const attempts = await Promise.all([
        rpc(client, "confirm_payout", { p_reference: p.reference, p_provider_ref: `SEL-ATTACK-${run}` }),
        rpc(client, "fail_payout", { p_reference: p.reference }),
      ])
      for (const r of attempts) {
        expect(r.error, `${who} was allowed to call a server function`).not.toBeNull()
        expect(["42501", "PGRST202"]).toContain(r.error!.code)
      }
    }

    const c1Refs = new Set((await myPayouts(c1.client)).map((x) => x.reference))
    const c2Refs = (await myPayouts(c2.client)).map((x) => x.reference)
    expect(c2Refs.some((ref) => c1Refs.has(ref))).toBe(false)

    const visitorList = await rpc(createAnonClient(), "list_my_payouts")
    expect(visitorList.error).not.toBeNull()

    const failed = await failPayout(p.reference)
    expect(failed.error).toBeNull()
    expect(await balance("creator_payable", c1.id)).toBe(payableBefore)
  })

  it("finishes with a clean integrity report", async () => {
    expect(await integrityProblems()).toEqual([])
  })
})