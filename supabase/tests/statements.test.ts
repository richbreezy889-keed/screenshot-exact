import { beforeAll, describe, expect, it } from "vitest";
import {
  applyToCampaign,
  approveApplication,
  createCampaign,
  submitVideo,
} from "./support/campaigns";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Row = {
  kind: string;
  account?: string;
  amount: string | number | bigint;
  balance_after: string | number | bigint;
  reference: string | null;
  campaign_id: string | null;
};

describe("wallet statements (phase 3)", () => {
  let db: Db;
  let brandA: string;
  let brandB: string;
  let campaignId = "";

  const brandStatement = async (
    userId: string | null,
    role: "anon" | "authenticated",
    limit = 100,
  ) => {
    await actAs(db, userId, role);
    return rows<Row>(db, "select * from public.brand_wallet_statement($1::uuid, $2::integer)", [
      brandA,
      limit,
    ]);
  };

  const creatorStatement = async (userId: string | null, role: "anon" | "authenticated") => {
    await actAs(db, userId, role);
    return rows<Row>(db, "select * from public.creator_statement(100)");
  };

  const short = (list: Row[]) =>
    list.map((r) => [r.kind, Number(r.amount), Number(r.balance_after)]);

  beforeAll(async () => {
    db = await openDatabase();
    const ids = await seedIdentity(db);
    brandA = ids.brandA;
    brandB = ids.brandB;

    // A deposit of 1,200,000, confirmed by Selcom.
    await actAs(db, IDS.brandAOwner, "authenticated");
    const deposit = await one<{ reference: string }>(
      db,
      "select * from public.request_deposit($1::uuid, $2::bigint)",
      [brandA, 1_200_000],
    );
    await actAs(db, null, "service_role");
    await one(db, "select public.confirm_deposit($1::text, $2::text, $3::bigint) as id", [
      deposit!.reference,
      "SEL-STMT-1",
      1_200_000,
    ]);

    // A 1,000,000 campaign, funded from the wallet.
    const campaign = await createCampaign(db, brandA, {
      budget: 1_000_000,
      creators: 2,
      rate: 4000,
      maxVideos: 2,
      title: "Statement campaign",
    });
    campaignId = campaign.id;
    await actAs(db, IDS.brandAOwner, "authenticated");
    await one(db, "select public.publish_campaign($1::uuid) as id", [campaignId]);

    // A creator posts, an admin verifies 10,000 views: gross 40,000, fee 6,000, net 34,000.
    const application = await applyToCampaign(db, campaignId, IDS.creator1);
    await approveApplication(db, application.id);
    const video = await submitVideo(db, {
      applicationId: application.id,
      campaignId,
      creatorId: IDS.creator1,
      postedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    await actAs(db, IDS.admin, "authenticated");
    await db.query(
      `update public.view_checkpoints
       set views = 10000, status = 'verified', evidence_url = 'https://example.com/evidence.png'
       where submission_id = $1`,
      [video.id],
    );

    // The hold ends and the earnings are released.
    await asPostgres(db);
    await db.query(
      "update ledger.checkpoint_accruals set release_at = now() - interval '1 minute' where campaign_id = $1",
      [campaignId],
    );
    await actAs(db, null, "service_role");
    await one(db, "select public.release_due_accruals() as n");

    // The creator withdraws 10,000.
    await actAs(db, IDS.creator1, "authenticated");
    await one(db, "select * from public.request_payout($1::bigint, $2::text)", [10_000, "0712345678"]);

    // The brand cancels, so the unspent 960,000 returns to the wallet.
    await actAs(db, IDS.brandAOwner, "authenticated");
    await one(db, "select public.cancel_campaign($1::uuid, $2::text) as s", [
      campaignId,
      "statement test: closing early",
    ]);

    // The brand asks to withdraw 100,000, and the withdrawal fails.
    const withdrawal = await one<{ reference: string }>(
      db,
      "select * from public.request_brand_withdrawal($1::uuid, $2::bigint, $3::text)",
      [brandA, 100_000, "0712345678"],
    );
    await actAs(db, null, "service_role");
    await one(db, "select public.fail_brand_withdrawal($1::text, null::text) as s", [
      withdrawal!.reference,
    ]);
  });

  it("shows every wallet movement, newest first, with running balances", async () => {
    const statement = await brandStatement(IDS.brandAOwner, "authenticated");

    expect(short(statement)).toEqual([
      ["brand_withdrawal_failed", 100_000, 1_160_000],
      ["brand_withdrawal_request", -100_000, 1_060_000],
      ["campaign_close", 960_000, 1_160_000],
      ["campaign_funding", -1_000_000, 200_000],
      ["deposit", 1_200_000, 1_200_000],
    ]);

    expect(statement[0]!.reference).toMatch(/^withdrawal BW/);
    expect(statement[1]!.reference).toMatch(/^withdrawal BW/);
    expect(statement[2]!.campaign_id).toBe(campaignId);
    expect(statement[3]!.campaign_id).toBe(campaignId);
    expect(statement[4]!.reference).toMatch(/^deposit BD/);
    expect(statement[4]!.campaign_id).toBeNull();
  });

  it("ends on the same figure as the live wallet balance", async () => {
    const statement = await brandStatement(IDS.brandAOwner, "authenticated");
    await actAs(db, IDS.brandAOwner, "authenticated");
    const live = await one<{ b: string | number | bigint }>(
      db,
      "select public.brand_wallet_summary($1::uuid) as b",
      [brandA],
    );
    expect(Number(statement[0]!.balance_after)).toBe(Number(live!.b));
  });

  it("limits the number of rows, never below one", async () => {
    const two = await brandStatement(IDS.brandAOwner, "authenticated", 2);
    expect(short(two)).toEqual([
      ["brand_withdrawal_failed", 100_000, 1_160_000],
      ["brand_withdrawal_request", -100_000, 1_060_000],
    ]);
    expect(await brandStatement(IDS.brandAOwner, "authenticated", 0)).toHaveLength(1);
  });

  it("shows the brand statement only to the brand's members and admins", async () => {
    expect(await brandStatement(IDS.brandAViewer, "authenticated")).toHaveLength(5);
    expect(await brandStatement(IDS.admin, "authenticated")).toHaveLength(5);

    for (const userId of [IDS.brandBOwner, IDS.creator1]) {
      await expect(brandStatement(userId, "authenticated")).rejects.toThrow(/not allowed to view/);
    }
    await expect(brandStatement(null, "anon")).rejects.toThrow(/permission denied/);

    await actAs(db, IDS.brandBOwner, "authenticated");
    const own = await rows<Row>(db, "select * from public.brand_wallet_statement($1::uuid)", [brandB]);
    expect(own).toHaveLength(0);
  });

  it("shows a creator their own earnings and payouts, with running balances per account", async () => {
    const statement = await creatorStatement(IDS.creator1, "authenticated");
    const pending = statement.filter((r) => r.account === "creator_pending");
    const payable = statement.filter((r) => r.account === "creator_payable");

    expect(short(pending)).toEqual([
      ["payout_release", -34_000, 0],
      ["checkpoint_accrual", 34_000, 34_000],
    ]);
    expect(short(payable)).toEqual([
      ["payout_request", -10_000, 24_000],
      ["payout_release", 34_000, 34_000],
    ]);

    const accrual = pending.find((r) => r.kind === "checkpoint_accrual")!;
    expect(accrual.campaign_id).toBe(campaignId);
    expect(payable.find((r) => r.kind === "payout_release")!.campaign_id).toBe(campaignId);

    const request = payable.find((r) => r.kind === "payout_request")!;
    expect(request.reference).toMatch(/^payout PO/);
    expect(request.campaign_id).toBeNull();
  });

  it("ends on the same figures as the creator's live balances", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    const balances = await one<{
      pending: string | number | bigint;
      payable: string | number | bigint;
      in_flight: string | number | bigint;
    }>(db, "select * from public.creator_balances()");

    const statement = await creatorStatement(IDS.creator1, "authenticated");
    const newest = (account: string) =>
      Number(statement.find((r) => r.account === account)!.balance_after);

    expect(newest("creator_pending")).toBe(Number(balances!.pending));
    expect(newest("creator_payable")).toBe(Number(balances!.payable));
    expect(Number(balances!.in_flight)).toBe(10_000);
  });

  it("shows nobody else's earnings", async () => {
    expect(await creatorStatement(IDS.creator2, "authenticated")).toHaveLength(0);
    expect(await creatorStatement(IDS.brandAOwner, "authenticated")).toHaveLength(0);
    await expect(creatorStatement(null, "anon")).rejects.toThrow(/permission denied/);
  });

  it("keeps the ledger consistent after reading it", async () => {
    await actAs(db, null, "service_role");
    const report = await rows<{ check_name: string; ok: boolean; detail: string }>(
      db,
      "select * from public.ledger_integrity_report()",
    );
    expect(report).toHaveLength(4);
    for (const row of report) {
      expect(row.ok, `${row.check_name}: ${row.detail}`).toBe(true);
    }
  });
});