import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type Deposit = { deposit_id: string; reference: string; amount: number | string; status: string }
type RpcResult = { data: unknown; error: DbError }

describe("deposits (concurrency and access)", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let other: TestUser
  let creator: TestUser
  let brandId = ""

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown>) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  async function request(client: SupabaseClient, brand: string, amount: number) {
    const r = await rpc(client, "request_deposit", { p_brand_id: brand, p_amount: amount })
    return { data: r.data as Deposit[] | null, error: r.error }
  }

  async function mustRequest(amount: number): Promise<Deposit> {
    const r = await request(owner.client, brandId, amount)
    if (r.error) throw r.error
    return r.data![0]
  }

  const confirm = (reference: string, providerRef: string, amount: number) =>
    rpc(service, "confirm_deposit", {
      p_reference: reference,
      p_provider_ref: providerRef,
      p_amount: amount,
    })

  async function wallet(brand: string): Promise<number> {
    const r = await rpc(owner.client, "brand_wallet_summary", { p_brand_id: brand })
    if (r.error) throw r.error
    return Number(r.data)
  }

  async function selcomHeld(): Promise<number> {
    const id = await rpc(service, "ledger_ensure_account", { p_kind: "selcom_holdings" })
    if (id.error) throw id.error
    const bal = await rpc(service, "ledger_balance", { p_account_id: id.data })
    if (bal.error) throw bal.error
    return Number(bal.data)
  }

  async function depositCount(): Promise<number> {
    const r = await rpc(owner.client, "list_brand_deposits", { p_brand_id: brandId, p_limit: 200 })
    if (r.error) throw r.error
    return (r.data as unknown[]).length
  }

  async function integrityProblems(): Promise<string[]> {
    const r = await rpc(service, "ledger_integrity_report", {})
    if (r.error) throw r.error
    return (r.data as { check_name: string; ok: boolean; detail: string }[])
      .filter((row) => !row.ok)
      .map((row) => `${row.check_name}: ${row.detail}`)
  }

  beforeAll(async () => {
    service = createServiceClient()
    owner = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
    other = await ensureUser(service, "hosted-brand-owner-2@biboh.test", "brand")
    creator = await ensureUser(service, "hosted-creator-1@biboh.test", "creator")
    await ensureCreatorRow(creator.client)
    brandId = await createBrand(owner.client, `hosted-test-deposits-${run}`)
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("an owner can request a deposit and gets a reference", async () => {
    const r = await request(owner.client, brandId, 50_000)
    expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(r.data).toHaveLength(1)
    expect(r.data![0].reference).toMatch(/^BD[0-9A-F]{16}$/)
    expect(r.data![0].status).toBe("pending")
    expect(Number(r.data![0].amount)).toBe(50_000)
  })

  it("everyone else is refused and nothing is created", async () => {
    const before = await depositCount()
    const callers: [string, SupabaseClient][] = [
      ["another brand's owner", other.client],
      ["a creator", creator.client],
      ["a visitor", createAnonClient()],
    ]

    for (const [who, client] of callers) {
      const r = await request(client, brandId, 5_000)
      expect(r.error, `${who} was allowed to request a deposit`).not.toBeNull()
      expect(r.error!.code).toBe("42501")
      if (who !== "a visitor") {
        expect(r.error!.message ?? "").toContain("not allowed to deposit")
      }
    }

    expect(await depositCount()).toBe(before)
  })

  it("the same Selcom confirmation delivered 8 times at once credits once", async () => {
    const d = await mustRequest(100_000)
    const walletBefore = await wallet(brandId)
    const selcomBefore = await selcomHeld()
    const providerRef = `SEL-HOSTED-${run}-A`

    const results = await Promise.all(
      Array.from({ length: 8 }, () => confirm(d.reference, providerRef, 100_000)),
    )
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(new Set(results.map((r) => r.data)).size).toBe(1)

    expect(await wallet(brandId)).toBe(walletBefore + 100_000)
    expect(await selcomHeld()).toBe(selcomBefore + 100_000)
  })

  it("one Selcom payment cannot credit two deposits at once", async () => {
    const first = await mustRequest(30_000)
    const second = await mustRequest(30_000)
    const walletBefore = await wallet(brandId)
    const providerRef = `SEL-HOSTED-${run}-B`

    const results = await Promise.all([
      confirm(first.reference, providerRef, 30_000),
      confirm(second.reference, providerRef, 30_000),
    ])
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].error!.code).toBe("23505")

    expect(await wallet(brandId)).toBe(walletBefore + 30_000)
  })

  it("a late payment still credits a deposit that already expired", async () => {
    const d = await mustRequest(40_000)
    const walletBefore = await wallet(brandId)

    const expired = await rpc(service, "expire_stale_deposits", { p_older_than: "0 seconds" })
    expect(expired.error, JSON.stringify(expired.error)).toBeNull()
    expect(Number(expired.data)).toBeGreaterThanOrEqual(1)

    const r = await confirm(d.reference, `SEL-HOSTED-${run}-C`, 40_000)
    expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(await wallet(brandId)).toBe(walletBefore + 40_000)
  })

  it("a failed deposit cannot be confirmed afterwards", async () => {
    const d = await mustRequest(15_000)
    const walletBefore = await wallet(brandId)

    const failed = await rpc(service, "fail_deposit", { p_reference: d.reference })
    expect(failed.error).toBeNull()
    expect(failed.data).toBe("failed")

    const r = await confirm(d.reference, `SEL-HOSTED-${run}-D`, 15_000)
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe("23514")
    expect(r.error!.message ?? "").toContain("marked failed")
    expect(await wallet(brandId)).toBe(walletBefore)
  })

  it("a confirmation for the wrong amount is refused", async () => {
    const d = await mustRequest(20_000)
    const walletBefore = await wallet(brandId)

    const r = await confirm(d.reference, `SEL-HOSTED-${run}-E`, 19_999)
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe("23514")
    expect(r.error!.message ?? "").toContain("amount mismatch")
    expect(await wallet(brandId)).toBe(walletBefore)
  })

  it("15 deposit requests at once for a fresh brand: exactly 10 get through", async () => {
    const freshBrand = await createBrand(owner.client, `hosted-test-deposits-cap-${run}`)

    const results = await Promise.all(
      Array.from({ length: 15 }, () => request(owner.client, freshBrand, 5_000)),
    )
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)

    expect(winners).toHaveLength(10)
    expect(losers).toHaveLength(5)
    for (const r of losers) {
      expect(r.error!.code).toBe("23514")
      expect(r.error!.message ?? "").toContain("too many pending deposits")
    }
    expect(new Set(winners.map((r) => r.data![0].reference)).size).toBe(10)
  })

  it("apps cannot confirm, fail or expire deposits", async () => {
    const d = await mustRequest(10_000)
    const walletBefore = await wallet(brandId)
    const callers: [string, SupabaseClient][] = [
      ["a visitor", createAnonClient()],
      ["the brand owner", owner.client],
      ["another brand's owner", other.client],
    ]

    for (const [who, client] of callers) {
      const attempts = await Promise.all([
        rpc(client, "confirm_deposit", {
          p_reference: d.reference,
          p_provider_ref: `SEL-ATTACK-${run}`,
          p_amount: 10_000,
        }),
        rpc(client, "fail_deposit", { p_reference: d.reference }),
        rpc(client, "expire_stale_deposits", { p_older_than: "0 seconds" }),
      ])
      for (const r of attempts) {
        expect(r.error, `${who} was allowed to call a server function`).not.toBeNull()
        expect(["42501", "PGRST202"]).toContain(r.error!.code)
      }
    }

    expect(await wallet(brandId)).toBe(walletBefore)
  })

  it("only members of a brand can see its wallet and deposits", async () => {
    const callers: [string, SupabaseClient][] = [
      ["another brand's owner", other.client],
      ["a creator", creator.client],
      ["a visitor", createAnonClient()],
    ]

    for (const [who, client] of callers) {
      const summary = await rpc(client, "brand_wallet_summary", { p_brand_id: brandId })
      expect(summary.error, `${who} could read the wallet`).not.toBeNull()
      expect(summary.error!.code).toBe("42501")

      const list = await rpc(client, "list_brand_deposits", { p_brand_id: brandId })
      expect(list.error, `${who} could read the deposits`).not.toBeNull()
      expect(list.error!.code).toBe("42501")
    }
  })

  it("the wallet adds up and the books are clean", async () => {
    // 100,000 + 30,000 + 40,000 confirmed in this run.
    expect(await wallet(brandId)).toBe(170_000)
    expect(await integrityProblems()).toEqual([])
  })
})