import { describe, expect, it, vi } from "vitest"
import {
  WalletFailure,
  createBrandWith,
  fetchBrandDeposits,
  fetchWalletStatement,
  fetchWalletSummary,
  getMyBrandId,
} from "@/lib/wallet-api"
import { dict } from "@/lib/i18n"

function rpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => result) } as any
}

function membersClient(result: { data: unknown; error: unknown }) {
  const limit = vi.fn(async () => result)
  const eq = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, select, eq, limit } as any
}

describe("getMyBrandId", () => {
  it("returns the first brand id for the user", async () => {
    const sb = membersClient({ data: [{ brand_id: "b1" }], error: null })
    await expect(getMyBrandId(sb, "u1")).resolves.toBe("b1")
    expect(sb.from).toHaveBeenCalledWith("brand_members")
    expect(sb.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("returns null when the user has no brand", async () => {
    const sb = membersClient({ data: [], error: null })
    await expect(getMyBrandId(sb, "u1")).resolves.toBeNull()
  })

  it("throws a WalletFailure on error", async () => {
    const sb = membersClient({ data: null, error: { message: "boom" } })
    await expect(getMyBrandId(sb, "u1")).rejects.toBeInstanceOf(WalletFailure)
  })
})

describe("createBrandWith", () => {
  it("returns the id of the created brand row", async () => {
    const sb = rpcClient({ data: { id: "b9", name: "Zuri" }, error: null })
    await expect(createBrandWith(sb, "  Zuri  ")).resolves.toBe("b9")
    expect(sb.rpc).toHaveBeenCalledWith("create_brand", { brand_name: "Zuri" })
  })

  it("rejects a blank name without calling the database", async () => {
    const sb = rpcClient({ data: null, error: null })
    await expect(createBrandWith(sb, "   ")).rejects.toBeInstanceOf(WalletFailure)
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it("fails when no id comes back", async () => {
    const sb = rpcClient({ data: null, error: null })
    await expect(createBrandWith(sb, "Zuri")).rejects.toMatchObject({ reason: "unknown" })
  })
})

describe("wallet reads", () => {
  it("fetchWalletSummary returns a number and passes the brand id", async () => {
    const sb = rpcClient({ data: 125000, error: null })
    await expect(fetchWalletSummary(sb, "b1")).resolves.toBe(125000)
    expect(sb.rpc).toHaveBeenCalledWith("brand_wallet_summary", { p_brand_id: "b1" })
  })

  it("fetchWalletStatement passes the limit and returns rows", async () => {
    const rows = [{ entry_id: 1, kind: "deposit" }]
    const sb = rpcClient({ data: rows, error: null })
    await expect(fetchWalletStatement(sb, "b1", 20)).resolves.toEqual(rows)
    expect(sb.rpc).toHaveBeenCalledWith("brand_wallet_statement", {
      p_brand_id: "b1",
      p_limit: 20,
    })
  })

  it("returns an empty list when the database returns null", async () => {
    await expect(fetchWalletStatement(rpcClient({ data: null, error: null }), "b1")).resolves.toEqual([])
    await expect(fetchBrandDeposits(rpcClient({ data: null, error: null }), "b1")).resolves.toEqual([])
  })

  it("fetchBrandDeposits calls list_brand_deposits", async () => {
    const sb = rpcClient({ data: [], error: null })
    await fetchBrandDeposits(sb, "b1")
    expect(sb.rpc).toHaveBeenCalledWith("list_brand_deposits", {
      p_brand_id: "b1",
      p_limit: 50,
    })
  })
})

describe("error mapping", () => {
  it("maps insufficient_privilege to notAllowed", async () => {
    const sb = rpcClient({ data: null, error: { code: "42501", message: "x" } })
    await expect(fetchWalletSummary(sb, "b1")).rejects.toMatchObject({ reason: "notAllowed" })
  })

  it("maps the not-allowed message to notAllowed", async () => {
    const sb = rpcClient({
      data: null,
      error: { message: "not allowed to view this brand's wallet" },
    })
    await expect(fetchWalletStatement(sb, "b1")).rejects.toMatchObject({ reason: "notAllowed" })
  })

  it("maps fetch failures to network", async () => {
    const sb = rpcClient({ data: null, error: { message: "TypeError: Failed to fetch" } })
    await expect(fetchBrandDeposits(sb, "b1")).rejects.toMatchObject({ reason: "network" })
  })

  it("maps anything else to unknown, never raw text", async () => {
    const sb = rpcClient({ data: null, error: { message: "raw server text" } })
    const err = await fetchWalletSummary(sb, "b1").catch((e) => e)
    expect(err).toBeInstanceOf(WalletFailure)
    expect(err.reason).toBe("unknown")
  })
})

describe("wallet translations", () => {
  const keys = Object.keys(dict).filter((k) => k.startsWith("walletLive."))

  it("has the expected set of keys", () => {
    expect(keys.length).toBe(33)
  })

  it.each(keys)("%s exists in English and Swahili", (key) => {
    const entry = (dict as any)[key]
    expect(entry.en.length).toBeGreaterThan(0)
    expect(entry.sw.length).toBeGreaterThan(0)
  })

  it.each([
    "deposit",
    "campaign_funding",
    "campaign_close",
    "brand_withdrawal_request",
    "brand_withdrawal_settle",
    "brand_withdrawal_failed",
  ])("has a label for ledger kind %s", (kind) => {
    expect((dict as any)[`walletLive.kind.${kind}`]).toBeDefined()
  })

  it.each(["pending", "confirmed", "failed", "expired"])(
    "has a label for deposit status %s",
    (status) => {
      expect((dict as any)[`walletLive.status.${status}`]).toBeDefined()
    },
  )
})