import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, type TestUser } from "./support/fixtures"

type Line = { account_id: string; side: "debit" | "credit"; amount: number }
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

const ROUNDS = 10

describe("ledger (concurrency and access)", () => {
  let service: ReturnType<typeof createServiceClient>
  let attacker: TestUser
  let selcom = ""
  let transit = ""
  let fees = ""
  const run = Date.now()

  const post = (key: string, lines: Line[]): Promise<RpcResult> =>
    Promise.resolve(
      service.rpc("ledger_post", {
        p_kind: "hosted-test",
        p_idempotency_key: key,
        p_lines: lines,
      }),
    ) as Promise<RpcResult>

  async function balance(id: string): Promise<number> {
    const { data, error } = await service.rpc("ledger_balance", { p_account_id: id })
    if (error) throw error
    return Number(data)
  }

  async function ensure(kind: string): Promise<string> {
    const { data, error } = await service.rpc("ledger_ensure_account", { p_kind: kind })
    if (error) throw error
    return data as string
  }

  async function integrityProblems(): Promise<string[]> {
    const { data, error } = await service.rpc("ledger_integrity_report")
    if (error) throw error
    return (data as { check_name: string; ok: boolean; detail: string }[])
      .filter((r) => !r.ok)
      .map((r) => `${r.check_name}: ${r.detail}`)
  }

  beforeAll(async () => {
    service = createServiceClient()
    attacker = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it("creating the platform accounts at the same instant makes one of each", async () => {
    // Only a real race the first time on a fresh test project; afterwards the accounts exist.
    const kinds = ["selcom_holdings", "payout_in_transit", "platform_fees"]
    const results = await Promise.all(
      kinds.flatMap((kind) =>
        Array.from({ length: 6 }, () =>
          service.rpc("ledger_ensure_account", { p_kind: kind }),
        ),
      ),
    )
    for (const r of results) expect(r.error).toBeNull()

    const idsByKind = kinds.map((_, i) =>
      new Set(results.slice(i * 6, i * 6 + 6).map((r) => r.data as string)),
    )
    for (const ids of idsByKind) expect(ids.size).toBe(1)

    selcom = [...idsByKind[0]][0]
    transit = [...idsByKind[1]][0]
    fees = [...idsByKind[2]][0]
    expect(new Set([selcom, transit, fees]).size).toBe(3)
  })

  it("the same deposit delivered 8 times at once is recorded once", async () => {
    const before = { selcom: await balance(selcom), transit: await balance(transit) }
    const key = `hosted-dup-${run}`
    const lines: Line[] = [
      { account_id: selcom, side: "debit", amount: 1000 },
      { account_id: transit, side: "credit", amount: 1000 },
    ]

    const results = await Promise.all(Array.from({ length: 8 }, () => post(key, lines)))
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull()
    expect(new Set(results.map((r) => r.data)).size).toBe(1)

    expect(await balance(selcom)).toBe(before.selcom + 1000)
    expect(await balance(transit)).toBe(before.transit + 1000)
  })

  it("a reused key with different content is refused", async () => {
    const r = await post(`hosted-dup-${run}`, [
      { account_id: selcom, side: "debit", amount: 5000 },
      { account_id: transit, side: "credit", amount: 5000 },
    ])
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe("23505")
  })

  for (let round = 0; round < ROUNDS; round++) {
    it(`round ${round}: two payouts racing for one balance, only one wins`, async () => {
      const seed = await post(`hosted-seed-${run}-${round}`, [
        { account_id: selcom, side: "debit", amount: 500 },
        { account_id: transit, side: "credit", amount: 500 },
      ])
      expect(seed.error, JSON.stringify(seed.error)).toBeNull()

      const available = await balance(transit)
      expect(available).toBeGreaterThan(0)

      const withdraw = (tag: string) =>
        post(`hosted-wd-${run}-${round}-${tag}`, [
          { account_id: transit, side: "debit", amount: available },
          { account_id: selcom, side: "credit", amount: available },
        ])

      const selcomBefore = await balance(selcom)
      const [a, b] = await Promise.all([withdraw("a"), withdraw("b")])

      const winners = [a, b].filter((r) => !r.error)
      const losers = [a, b].filter((r) => r.error)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect(losers[0].error!.code).toBe("23514")
      expect(losers[0].error!.message ?? "").toContain("accounts_balance_check")

      expect(await balance(transit)).toBe(0)
      expect(await balance(selcom)).toBe(selcomBefore - available)
    })
  }

  it("twenty mixed deposits and withdrawals at once leave the books consistent", async () => {
    const before = await balance(transit)
    const jobs: Promise<RpcResult>[] = []
    for (let i = 0; i < 20; i++) {
      jobs.push(
        i % 2 === 0
          ? post(`hosted-mix-${run}-${i}`, [
              { account_id: selcom, side: "debit", amount: 100 },
              { account_id: transit, side: "credit", amount: 100 },
            ])
          : post(`hosted-mix-${run}-${i}`, [
              { account_id: transit, side: "debit", amount: 100 },
              { account_id: selcom, side: "credit", amount: 100 },
            ]),
      )
    }
    const results = await Promise.all(jobs)

    for (const r of results) {
      if (r.error) {
        // The only acceptable failure is a withdrawal that found the balance empty.
        expect(r.error.code).toBe("23514")
        expect(r.error.message ?? "").toContain("accounts_balance_check")
      }
    }

    const deposits = results.filter((_, i) => i % 2 === 0 && !results[i].error).length
    const withdrawals = results.filter((_, i) => i % 2 === 1 && !results[i].error).length
    expect(await balance(transit)).toBe(before + 100 * deposits - 100 * withdrawals)
    expect(await integrityProblems()).toEqual([])
  })

  it("apps cannot call any ledger function", async () => {
    const callers = [
      ["a visitor", createAnonClient()],
      ["a signed-in user", attacker.client],
    ] as const

    for (const [who, client] of callers) {
      const attempts = await Promise.all([
        client.rpc("ledger_balance", { p_account_id: selcom }),
        client.rpc("ledger_ensure_account", { p_kind: "platform_fees" }),
        client.rpc("ledger_integrity_report"),
        client.rpc("ledger_post", {
          p_kind: "attack",
          p_idempotency_key: `hosted-attack-${run}`,
          p_lines: [
            { account_id: selcom, side: "debit", amount: 1 },
            { account_id: fees, side: "credit", amount: 1 },
          ],
        }),
      ])
      for (const r of attempts) {
        expect(r.error, `${who} was allowed to call a ledger function`).not.toBeNull()
        expect(["42501", "PGRST202"]).toContain(r.error!.code)
      }
    }

    const { data } = await service.rpc("ledger_balance", { p_account_id: fees })
    expect(Number(data)).toBe(0)
  })

  it("the ledger tables are not reachable through the public API", async () => {
    const tables = ["accounts", "transactions", "entries"]
    for (const client of [createAnonClient(), attacker.client, service]) {
      for (const table of tables) {
        const { data, error } = await client.from(table).select("*").limit(1)
        expect(error !== null || (data ?? []).length === 0).toBe(true)
      }
    }
  })

  it("finishes with a clean integrity report", async () => {
    expect(await integrityProblems()).toEqual([])
  })
})