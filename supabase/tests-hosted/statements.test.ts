import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type RpcResult = { data: unknown; error: DbError }
type Line = {
  kind: string
  account?: string
  amount: number | string
  balance_after: number | string
  reference: string | null
}

describe("wallet statements (access and figures)", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let other: TestUser
  let j1: TestUser
  let c2: TestUser
  let brand = ""

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  beforeAll(async () => {
    service = createServiceClient()
    owner = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
    other = await ensureUser(service, "hosted-brand-owner-2@biboh.test", "brand")
    j1 = await ensureUser(service, "hosted-journey-creator-1@biboh.test", "creator")
    c2 = await ensureUser(service, "hosted-creator-2@biboh.test", "creator")
    await ensureCreatorRow(j1.client)
    await ensureCreatorRow(c2.client)

    brand = await createBrand(owner.client, `hosted-test-statements-${run}`)
    const req = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: 20_000 })
    if (req.error) throw req.error
    const conf = await rpc(service, "confirm_deposit", {
      p_reference: (req.data as { reference: string }[])[0].reference,
      p_provider_ref: `SEL-HST-${run}`,
      p_amount: 20_000,
    })
    if (conf.error) throw conf.error
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("a brand sees its deposit on the statement with the right balance", async () => {
    const r = await rpc(owner.client, "brand_wallet_statement", { p_brand_id: brand })
    expect(r.error, JSON.stringify(r.error)).toBeNull()
    const lines = r.data as Line[]
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe("deposit")
    expect(Number(lines[0].amount)).toBe(20_000)
    expect(Number(lines[0].balance_after)).toBe(20_000)
    expect(lines[0].reference ?? "").toMatch(/^deposit BD/)

    const live = await rpc(owner.client, "brand_wallet_summary", { p_brand_id: brand })
    expect(Number(live.data)).toBe(20_000)
  })

  it("nobody outside the brand can read its statement", async () => {
    const callers: [string, SupabaseClient][] = [
      ["another brand's owner", other.client],
      ["a creator", c2.client],
      ["a visitor", createAnonClient()],
    ]
    for (const [who, client] of callers) {
      const r = await rpc(client, "brand_wallet_statement", { p_brand_id: brand })
      expect(r.error, `${who} could read the statement`).not.toBeNull()
      expect(["42501", "PGRST202"]).toContain(r.error!.code)
    }
  })

  it("a creator's statement ends on the same figures as their live balances", async () => {
    const stmt = await rpc(j1.client, "creator_statement", { p_limit: 500 })
    expect(stmt.error, JSON.stringify(stmt.error)).toBeNull()
    const lines = stmt.data as Line[]
    expect(lines.length).toBeGreaterThan(0)

    const bal = await rpc(j1.client, "creator_balances")
    expect(bal.error, JSON.stringify(bal.error)).toBeNull()
    const live = (bal.data as { pending: number | string; payable: number | string }[])[0]

    const newest = (account: string) => lines.find((l) => l.account === account)?.balance_after
    expect(Number(newest("creator_pending") ?? 0)).toBe(Number(live.pending))
    expect(Number(newest("creator_payable") ?? 0)).toBe(Number(live.payable))
  })

  it("a creator sees only their own earnings, and visitors see nothing", async () => {
    const mine = await rpc(j1.client, "creator_statement", { p_limit: 500 })
    const theirs = await rpc(c2.client, "creator_statement", { p_limit: 500 })
    expect(theirs.error).toBeNull()
    const myRefs = new Set((mine.data as Line[]).map((l) => `${l.kind}:${l.reference}`))
    for (const l of theirs.data as Line[]) {
      if (l.reference) expect(myRefs.has(`${l.kind}:${l.reference}`)).toBe(false)
    }

    const brandView = await rpc(owner.client, "creator_statement", { p_limit: 500 })
    expect(brandView.error).toBeNull()
    expect(brandView.data as Line[]).toHaveLength(0)

    const visitor = await rpc(createAnonClient(), "creator_statement", { p_limit: 500 })
    expect(visitor.error).not.toBeNull()
    expect(["42501", "PGRST202"]).toContain(visitor.error!.code)
  })

  it("finishes with a clean integrity report", async () => {
    const r = await rpc(service, "ledger_integrity_report")
    expect(r.error).toBeNull()
    const bad = (r.data as { ok: boolean; check_name: string; detail: string }[]).filter((x) => !x.ok)
    expect(bad).toEqual([])
  })
})