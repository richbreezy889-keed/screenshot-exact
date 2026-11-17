import { describe, it, beforeAll, afterAll, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, createBrand, ensureCreatorRow, type TestUser } from "./support/fixtures"

type DbError = { code?: string; message?: string } | null
type RpcResult = { data: unknown; error: DbError }
type Owner = { brand?: string; campaign?: string; creator?: string }
type Earning = { accrual_id: string; campaign_id: string; net: number | string; status: string }

const DEPOSIT = 1_200_000
const BUDGET = 1_000_000
const C1 = { views: 100_000, gross: 400_000, fee: 60_000, net: 340_000 }
const C2 = { views: 20_000, gross: 80_000, fee: 12_000, net: 68_000 }
const PAYOUT = 300_000
const WITHDRAWAL = 700_000

describe("full journey: from a brand's deposit to its last withdrawal", () => {
  const run = Date.now()
  let service: ReturnType<typeof createServiceClient>
  let owner: TestUser
  let admin: TestUser
  let j1: TestUser
  let j2: TestUser

  const rpc = (client: SupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(client.rpc(fn, args)) as Promise<RpcResult>

  function ok(r: RpcResult, label: string) {
    expect(r.error, `${label}: ${JSON.stringify(r.error)}`).toBeNull()
  }

  async function balance(kind: string, who: Owner = {}): Promise<number> {
    const id = await rpc(service, "ledger_ensure_account", {
      p_kind: kind,
      p_brand_id: who.brand ?? null,
      p_campaign_id: who.campaign ?? null,
      p_creator_id: who.creator ?? null,
    })
    ok(id, `account ${kind}`)
    const b = await rpc(service, "ledger_balance", { p_account_id: id.data })
    ok(b, `balance ${kind}`)
    return Number(b.data)
  }

  async function healthy(label: string) {
    const r = await rpc(service, "ledger_integrity_report")
    ok(r, `integrity report ${label}`)
    const problems = (r.data as { check_name: string; ok: boolean; detail: string }[])
      .filter((row) => !row.ok)
      .map((row) => `${row.check_name}: ${row.detail}`)
    expect(problems, `the books are not clean ${label}`).toEqual([])
  }

  async function earningStatus(client: SupabaseClient, campaign: string): Promise<string | undefined> {
    const r = await rpc(client, "list_my_earnings")
    ok(r, "list earnings")
    return (r.data as Earning[]).find((e) => e.campaign_id === campaign)?.status
  }

  beforeAll(async () => {
    service = createServiceClient()
    owner = await ensureUser(service, "hosted-brand-owner-1@biboh.test", "brand")
    admin = await ensureUser(service, "hosted-admin@biboh.test", "admin")
    j1 = await ensureUser(service, "hosted-journey-creator-1@biboh.test", "creator")
    j2 = await ensureUser(service, "hosted-journey-creator-2@biboh.test", "creator")
    await ensureCreatorRow(j1.client)
    await ensureCreatorRow(j2.client)

    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id)
    if (promoted.error) throw promoted.error
  })

  afterAll(async () => {
    await cleanup(service)
  })

  it(
    "every step moves exactly the right money, and the books stay balanced",
    async () => {
      const log: string[] = []
      const base = {
        selcom: await balance("selcom_holdings"),
        transit: await balance("payout_in_transit"),
        fees: await balance("platform_fees"),
        j1Pending: await balance("creator_pending", { creator: j1.id }),
        j1Payable: await balance("creator_payable", { creator: j1.id }),
        j2Pending: await balance("creator_pending", { creator: j2.id }),
        j2Payable: await balance("creator_payable", { creator: j2.id }),
      }

      const brand = await createBrand(owner.client, `hosted-test-journey-${run}`)

      // 0. A deposit below the minimum is refused.
      const tooSmall = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: 1_000 })
      expect(tooSmall.error).not.toBeNull()
      expect(tooSmall.error!.code).toBe("23514")
      expect(tooSmall.error!.message ?? "").toContain("deposit amount must be between")

      // 1. The brand deposits, and Selcom confirms.
      const requested = await rpc(owner.client, "request_deposit", { p_brand_id: brand, p_amount: DEPOSIT })
      ok(requested, "request deposit")
      const reference = (requested.data as { reference: string }[])[0].reference
      const depositRef = `SEL-JOURNEY-${run}-D`
      ok(
        await rpc(service, "confirm_deposit", {
          p_reference: reference,
          p_provider_ref: depositRef,
          p_amount: DEPOSIT,
        }),
        "confirm deposit",
      )
      expect(await balance("brand_wallet", { brand })).toBe(DEPOSIT)
      expect(await balance("selcom_holdings")).toBe(base.selcom + DEPOSIT)
      await healthy("after the deposit")
      log.push(`1 deposit:        wallet ${DEPOSIT}`)

      // 2. The brand publishes a campaign.
      const created = await owner.client
        .from("campaigns")
        .insert({
          title: `hosted-test-journey-${run}`,
          brand_id: brand,
          status: "draft",
          platforms: ["tiktok"],
          rate_per_1k: 4000,
          budget: BUDGET,
          creators_needed: 2,
          videos_per_creator: 2,
          deadline: "2027-12-31",
        })
        .select("id")
        .single()
      if (created.error) throw created.error
      const campaign = created.data.id as string

      const original = await service.from("platform_settings").select("review_hours").eq("id", true).single()
      if (original.error) throw original.error
      const setHours = async (hours: number) => {
        const r = await service.from("platform_settings").update({ review_hours: hours }).eq("id", true)
        if (r.error) throw r.error
      }
      try {
        // The campaign copies this setting when it launches, so its earnings are due at once.
        await setHours(0)
        ok(await rpc(owner.client, "publish_campaign", { p_campaign_id: campaign }), "publish")
      } finally {
        await setHours(Number(original.data.review_hours))
      }

      expect(await balance("brand_wallet", { brand })).toBe(DEPOSIT - BUDGET)
      expect(await balance("campaign_escrow", { campaign })).toBe(BUDGET)
      await healthy("after publishing")
      log.push(`2 publish:        wallet ${DEPOSIT - BUDGET}, escrow ${BUDGET}`)

      // 3. Two creators post, and an admin verifies their views.
      const videos: string[] = []
      for (const creator of [j1, j2]) {
        const app = await creator.client
          .from("applications")
          .insert({ campaign_id: campaign, creator_id: creator.id })
          .select("id")
          .single()
        if (app.error) throw app.error
        const approved = await owner.client.from("applications").update({ status: "approved" }).eq("id", app.data.id)
        if (approved.error) throw approved.error

        const vid = await service
          .from("submissions")
          .insert({
            application_id: app.data.id,
            campaign_id: campaign,
            creator_id: creator.id,
            platform: "tiktok",
            video_url: `https://example.com/journey-${run}-${creator.id}`,
            posted_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
          })
          .select("id")
          .single()
        if (vid.error) throw vid.error
        videos.push(vid.data.id as string)
      }

      for (const [videoId, views] of [
        [videos[0], C1.views],
        [videos[1], C2.views],
      ] as [string, number][]) {
        const verified = await admin.client
          .from("view_checkpoints")
          .update({ views, status: "verified", evidence_url: "https://example.com/evidence.png" })
          .eq("submission_id", videoId)
          .select("id")
        if (verified.error) throw verified.error
        expect(verified.data).toHaveLength(1)
      }

      const earned = C1.gross + C2.gross
      expect(await balance("campaign_escrow", { campaign })).toBe(BUDGET - earned)
      expect(await balance("creator_pending", { creator: j1.id })).toBe(base.j1Pending + C1.net)
      expect(await balance("creator_pending", { creator: j2.id })).toBe(base.j2Pending + C2.net)
      expect(await balance("platform_fees")).toBe(base.fees + C1.fee + C2.fee)
      await healthy("after verification")
      log.push(`3 verify:         escrow ${BUDGET - earned}, fees +${C1.fee + C2.fee}`)

      // 4. The hold ends and the earnings are released.
      ok(await rpc(service, "release_due_accruals"), "release due accruals")
      expect(await earningStatus(j1.client, campaign)).toBe("released")
      expect(await earningStatus(j2.client, campaign)).toBe("released")
      expect(await balance("creator_pending", { creator: j1.id })).toBe(base.j1Pending)
      expect(await balance("creator_pending", { creator: j2.id })).toBe(base.j2Pending)
      expect(await balance("creator_payable", { creator: j1.id })).toBe(base.j1Payable + C1.net)
      expect(await balance("creator_payable", { creator: j2.id })).toBe(base.j2Payable + C2.net)
      await healthy("after the release")
      log.push(`4 release:        creator 1 ${C1.net}, creator 2 ${C2.net}`)

      // 5. One creator withdraws, and Selcom confirms.
      const payout = await rpc(j1.client, "request_payout", { p_amount: PAYOUT, p_destination: "0712345678" })
      ok(payout, "request payout")
      const payoutRef = (payout.data as { reference: string }[])[0].reference
      expect(await balance("creator_payable", { creator: j1.id })).toBe(base.j1Payable + C1.net - PAYOUT)
      expect(await balance("payout_in_transit")).toBe(base.transit + PAYOUT)

      const payoutProviderRef = `SEL-JOURNEY-${run}-P`
      ok(await rpc(service, "confirm_payout", { p_reference: payoutRef, p_provider_ref: payoutProviderRef }), "confirm payout")
      expect(await balance("payout_in_transit")).toBe(base.transit)
      expect(await balance("selcom_holdings")).toBe(base.selcom + DEPOSIT - PAYOUT)
      await healthy("after the creator payout")
      log.push(`5 payout:         creator 1 withdrew ${PAYOUT}`)

      // 6. The brand cancels, and the unspent budget comes back.
      ok(
        await rpc(owner.client, "cancel_campaign", {
          p_campaign_id: campaign,
          p_reason: "journey test: stopping the campaign",
        }),
        "cancel campaign",
      )
      const state = await service.from("campaigns").select("status").eq("id", campaign).single()
      if (state.error) throw state.error
      expect(state.data.status).toBe("cancelled")

      const returned = BUDGET - earned
      expect(await balance("campaign_escrow", { campaign })).toBe(0)
      expect(await balance("brand_wallet", { brand })).toBe(DEPOSIT - BUDGET + returned)
      await healthy("after cancelling")
      log.push(`6 cancel:         ${returned} returned, wallet ${DEPOSIT - BUDGET + returned}`)

      // 7. The brand withdraws, and Selcom confirms.
      const withdrawal = await rpc(owner.client, "request_brand_withdrawal", {
        p_brand_id: brand,
        p_amount: WITHDRAWAL,
        p_destination: "0712345678",
      })
      ok(withdrawal, "request brand withdrawal")
      const withdrawalRef = (withdrawal.data as { reference: string }[])[0].reference
      const walletAfter = DEPOSIT - BUDGET + returned - WITHDRAWAL
      expect(await balance("brand_wallet", { brand })).toBe(walletAfter)

      const withdrawalProviderRef = `SEL-JOURNEY-${run}-W`
      ok(
        await rpc(service, "confirm_brand_withdrawal", {
          p_reference: withdrawalRef,
          p_provider_ref: withdrawalProviderRef,
        }),
        "confirm brand withdrawal",
      )
      expect(await balance("payout_in_transit")).toBe(base.transit)
      expect(await balance("selcom_holdings")).toBe(base.selcom + DEPOSIT - PAYOUT - WITHDRAWAL)
      await healthy("after the brand withdrawal")
      log.push(`7 withdrawal:     brand withdrew ${WITHDRAWAL}, wallet ${walletAfter}`)

      // 8. Repeating every job and confirmation changes nothing.
      const snapshot = async () => ({
        wallet: await balance("brand_wallet", { brand }),
        escrow: await balance("campaign_escrow", { campaign }),
        selcom: await balance("selcom_holdings"),
        transit: await balance("payout_in_transit"),
        fees: await balance("platform_fees"),
        j1Payable: await balance("creator_payable", { creator: j1.id }),
        j2Payable: await balance("creator_payable", { creator: j2.id }),
      })
      const before = await snapshot()

      ok(await rpc(service, "release_due_accruals"), "release again")
      ok(await rpc(service, "close_due_campaigns"), "close again")
      ok(
        await rpc(service, "confirm_deposit", {
          p_reference: reference,
          p_provider_ref: depositRef,
          p_amount: DEPOSIT,
        }),
        "confirm deposit again",
      )
      ok(await rpc(service, "confirm_payout", { p_reference: payoutRef, p_provider_ref: payoutProviderRef }), "confirm payout again")
      ok(
        await rpc(service, "confirm_brand_withdrawal", {
          p_reference: withdrawalRef,
          p_provider_ref: withdrawalProviderRef,
        }),
        "confirm withdrawal again",
      )
      ok(
        await rpc(owner.client, "cancel_campaign", {
          p_campaign_id: campaign,
          p_reason: "journey test: stopping the campaign",
        }),
        "cancel again",
      )
      expect(await snapshot()).toEqual(before)
      log.push("8 repeat:         nothing changed")

      // Conservation: what Selcom holds for us equals what we owe.
      const heldDelta = (await balance("selcom_holdings")) - base.selcom
      const owedDelta =
        (await balance("brand_wallet", { brand })) +
        (await balance("campaign_escrow", { campaign })) +
        (await balance("creator_pending", { creator: j1.id })) -
        base.j1Pending +
        ((await balance("creator_pending", { creator: j2.id })) - base.j2Pending) +
        ((await balance("creator_payable", { creator: j1.id })) - base.j1Payable) +
        ((await balance("creator_payable", { creator: j2.id })) - base.j2Payable) +
        ((await balance("platform_fees")) - base.fees) +
        ((await balance("payout_in_transit")) - base.transit)
      expect(heldDelta).toBe(DEPOSIT - PAYOUT - WITHDRAWAL)
      expect(owedDelta).toBe(heldDelta)
      await healthy("at the end")
      log.push(`end: Selcom holds ${heldDelta} for us and we owe exactly ${owedDelta}`)

      console.log(`\nJOURNEY\n${log.join("\n")}\n`)
    },
    240_000,
  )
})