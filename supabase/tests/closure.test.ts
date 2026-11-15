import { beforeAll, describe, expect, it } from "vitest";
import {
  applyToCampaign,
  approveApplication,
  createCampaign,
  publishCampaign,
  submitVideo,
} from "./support/campaigns";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Role = "anon" | "authenticated";
type Requested = {
  withdrawal_id: string;
  reference: string;
  amount: string | number | bigint;
  destination: string;
  status: string;
};

const BASE = { budget: 1_000_000, creators: 2, rate: 4000, maxVideos: 2 };
const DEST = "0712345678";

describe("cancelling, closing and brand withdrawals (phase 2d)", () => {
  let db: Db;
  let brandA: string;
  let brandB: string;
  let depositSeq = 0;
  let firstReference = "";

  async function deposit(brand: string, ownerId: string, amount: number) {
    await actAs(db, ownerId, "authenticated");
    const requested = await one<{ reference: string }>(
      db,
      "select * from public.request_deposit($1::uuid, $2::bigint)",
      [brand, amount],
    );
    await actAs(db, null, "service_role");
    depositSeq += 1;
    await one(db, "select public.confirm_deposit($1::text, $2::text, $3::bigint) as id", [
      requested!.reference,
      `SEL-CLOSE-${depositSeq}`,
      amount,
    ]);
  }

  async function balanceOf(
    kind: string,
    owner: { brand?: string; campaign?: string; creator?: string } = {},
  ): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ b: string | number | bigint }>(
      db,
      "select public.ledger_balance(public.ledger_ensure_account($1::text, $2::uuid, $3::uuid, $4::uuid)) as b",
      [kind, owner.brand ?? null, owner.campaign ?? null, owner.creator ?? null],
    );
    return Number(result!.b);
  }

  async function publish(campaignId: string) {
    await actAs(db, IDS.brandAOwner, "authenticated");
    await one(db, "select public.publish_campaign($1::uuid) as id", [campaignId]);
  }

  async function fundedCampaign(title: string, overrides: Partial<typeof BASE> = {}) {
    const campaign = await createCampaign(db, brandA, { ...BASE, ...overrides, title });
    await deposit(brandA, IDS.brandAOwner, Number(campaign.budget));
    await publish(campaign.id);
    return campaign;
  }

  async function approvedApplication(campaignId: string, creatorId: string) {
    const application = await applyToCampaign(db, campaignId, creatorId);
    await approveApplication(db, application.id);
    return application;
  }

  async function postVideo(applicationId: string, campaignId: string, creatorId: string) {
    return submitVideo(db, {
      applicationId,
      campaignId,
      creatorId,
      postedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
  }

  async function verify(submissionId: string, views: number) {
    await actAs(db, IDS.admin, "authenticated");
    await db.query(
      `update public.view_checkpoints
       set views = $2, status = 'verified', evidence_url = 'https://example.com/evidence.png'
       where submission_id = $1`,
      [submissionId, views],
    );
  }

  async function accrualOf(submissionId: string) {
    await asPostgres(db);
    return one<{ id: string; status: string }>(
      db,
      `select a.id, a.status from ledger.checkpoint_accruals a
       join public.view_checkpoints v on v.id = a.checkpoint_id
       where v.submission_id = $1`,
      [submissionId],
    );
  }

  async function backdateRelease(accrualId: string) {
    await asPostgres(db);
    await db.query(
      "update ledger.checkpoint_accruals set release_at = now() - interval '1 minute' where id = $1",
      [accrualId],
    );
  }

  async function releaseDue(): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ n: string | number | bigint }>(
      db,
      "select public.release_due_accruals() as n",
    );
    return Number(result!.n);
  }

  async function closeDue(): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ n: string | number | bigint }>(
      db,
      "select public.close_due_campaigns() as n",
    );
    return Number(result!.n);
  }

  async function cancel(userId: string | null, campaignId: string, reason: string): Promise<string> {
    await actAs(db, userId, userId ? "authenticated" : "anon");
    const result = await one<{ s: string }>(
      db,
      "select public.cancel_campaign($1::uuid, $2::text) as s",
      [campaignId, reason],
    );
    return result!.s;
  }

  async function statusOf(campaignId: string): Promise<string> {
    await asPostgres(db);
    const result = await one<{ s: string }>(
      db,
      "select status::text as s from public.campaigns where id = $1",
      [campaignId],
    );
    return result!.s;
  }

  async function closureOf(campaignId: string) {
    await asPostgres(db);
    return one<{ returned: string | number | bigint }>(
      db,
      "select returned from ledger.campaign_closures where campaign_id = $1",
      [campaignId],
    );
  }

  async function setDeadline(campaignId: string, date: string) {
    await asPostgres(db);
    try {
      await db.query("set session_replication_role = replica");
      await db.query("update public.campaigns set deadline = $2::date where id = $1", [
        campaignId,
        date,
      ]);
    } finally {
      await db.query("set session_replication_role = origin");
    }
  }

  async function requestWd(
    userId: string | null,
    role: Role,
    brand: string,
    amount: number,
    destination = DEST,
  ): Promise<Requested> {
    await actAs(db, userId, role);
    const result = await one<Requested>(
      db,
      "select * from public.request_brand_withdrawal($1::uuid, $2::bigint, $3::text)",
      [brand, amount, destination],
    );
    return result!;
  }

  async function confirmWd(reference: string, providerRef: string): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.confirm_brand_withdrawal($1::text, $2::text) as id",
      [reference, providerRef],
    );
    return result!.id;
  }

  async function failWd(reference: string): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ s: string }>(
      db,
      "select public.fail_brand_withdrawal($1::text, null::text) as s",
      [reference],
    );
    return result!.s;
  }

  beforeAll(async () => {
    db = await openDatabase();
    const ids = await seedIdentity(db);
    brandA = ids.brandA;
    brandB = ids.brandB;
  });

  it("cancelling with no videos posted returns the whole budget at once", async () => {
    const campaign = await fundedCampaign("Cancel clean");
    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(1_000_000);

    expect(await cancel(IDS.brandAManager, campaign.id, "we changed our plans")).toBe("cancelled");

    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(0);
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 1_000_000);
    expect(await statusOf(campaign.id)).toBe("cancelled");
    expect(Number((await closureOf(campaign.id))!.returned)).toBe(1_000_000);

    expect(await cancel(IDS.brandAOwner, campaign.id, "we changed our plans")).toBe("cancelled");
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 1_000_000);
  });

  it("only brand owners and managers can cancel, and only with a reason", async () => {
    const campaign = await fundedCampaign("Cancel permissions");

    for (const userId of [IDS.brandAViewer, IDS.creator1, IDS.brandBOwner]) {
      await expect(cancel(userId, campaign.id, "not my campaign to stop")).rejects.toThrow(
        /not allowed to cancel/,
      );
    }
    await expect(cancel(null, campaign.id, "a visitor trying it on")).rejects.toThrow(
      /permission denied/,
    );
    await expect(cancel(IDS.brandAOwner, campaign.id, "too short")).rejects.toThrow(
      /at least 10 characters/,
    );

    expect(await statusOf(campaign.id)).toBe("live");
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(1_000_000);
  });

  it("refuses to cancel after the 48-hour window", async () => {
    const campaign = await fundedCampaign("Cancel late");
    await asPostgres(db);
    await db.query("update public.campaigns set published_at = now() - interval '3 days' where id = $1", [
      campaign.id,
    ]);

    await expect(cancel(IDS.brandAOwner, campaign.id, "we are far too late")).rejects.toThrow(
      /48-hour cancellation window/,
    );
    expect(await statusOf(campaign.id)).toBe("live");
  });

  it("refuses to cancel a campaign that is not live", async () => {
    const draft = await createCampaign(db, brandA, { ...BASE, title: "Never published" });
    await expect(cancel(IDS.brandAOwner, draft.id, "this is still a draft")).rejects.toThrow(
      /only a live campaign/,
    );
  });

  it("videos already posted still pay, and escrow is returned only when all is settled", async () => {
    const campaign = await fundedCampaign("Cancel with video");
    const app1 = await approvedApplication(campaign.id, IDS.creator1);
    const app2 = await approvedApplication(campaign.id, IDS.creator2);
    const video = await postVideo(app1.id, campaign.id, IDS.creator1);

    await cancel(IDS.brandAOwner, campaign.id, "stopping this campaign early");
    expect(await statusOf(campaign.id)).toBe("cancelled");
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(1_000_000);
    expect(await closureOf(campaign.id)).toBeNull();

    await expect(
      submitVideo(db, { applicationId: app2.id, campaignId: campaign.id, creatorId: IDS.creator2 }),
    ).rejects.toThrow(/campaign must be live/);

    await closeDue();
    expect(await closureOf(campaign.id)).toBeNull();

    await verify(video.id, 10_000);
    const accrual = await accrualOf(video.id);
    expect(accrual!.status).toBe("held");
    await closeDue();
    expect(await closureOf(campaign.id)).toBeNull();

    await backdateRelease(accrual!.id);
    await releaseDue();
    expect((await accrualOf(video.id))!.status).toBe("released");

    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });
    await closeDue();

    expect(Number((await closureOf(campaign.id))!.returned)).toBe(960_000);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(0);
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 960_000);
    expect(await statusOf(campaign.id)).toBe("cancelled");
  });

  it("closes a campaign after its deadline, once", async () => {
    const campaign = await fundedCampaign("Deadline close");
    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });

    await closeDue();
    expect(await closureOf(campaign.id)).toBeNull();
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(1_000_000);

    await setDeadline(campaign.id, "2026-01-01");
    await closeDue();

    expect(await statusOf(campaign.id)).toBe("completed");
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(0);
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 1_000_000);
    expect(Number((await closureOf(campaign.id))!.returned)).toBe(1_000_000);

    await closeDue();
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 1_000_000);
  });

  it("waits for a flagged payout, and gets the money back when an admin reverses it", async () => {
    const campaign = await fundedCampaign("Close waits for flags");
    const app = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(app.id, campaign.id, IDS.creator1);
    await verify(video.id, 10_000);
    const accrual = await accrualOf(video.id);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await one(db, "select public.flag_accrual($1::uuid, $2::text) as s", [
      accrual!.id,
      "views look inflated by bots",
    ]);

    await setDeadline(campaign.id, "2026-01-01");
    await backdateRelease(accrual!.id);
    await releaseDue();
    await closeDue();
    expect(await closureOf(campaign.id)).toBeNull();

    await actAs(db, IDS.admin, "authenticated");
    await one(db, "select public.resolve_accrual_flag($1::uuid, 'reverse', $2::text) as s", [
      accrual!.id,
      "evidence shows the views were bought",
    ]);

    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });
    await closeDue();

    expect(Number((await closureOf(campaign.id))!.returned)).toBe(1_000_000);
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore + 1_000_000);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(0);
  });

  it("a rejected video does not hold the campaign open", async () => {
    const campaign = await fundedCampaign("Rejected video");
    const app = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(app.id, campaign.id, IDS.creator1);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await db.query("update public.submissions set status = 'rejected' where id = $1", [video.id]);

    await setDeadline(campaign.id, "2026-01-01");
    await closeDue();

    expect(Number((await closureOf(campaign.id))!.returned)).toBe(1_000_000);
    expect(await statusOf(campaign.id)).toBe("completed");
  });

  it("leaves campaigns published before the ledger alone", async () => {
    const campaign = await createCampaign(db, brandA, { ...BASE, title: "Legacy" });
    await publishCampaign(db, campaign.id);
    await setDeadline(campaign.id, "2026-01-01");

    await closeDue();

    expect(await statusOf(campaign.id)).toBe("live");
    expect(await closureOf(campaign.id)).toBeNull();
  });

  it("lets the owner withdraw to a mobile number, and Selcom settle it once", async () => {
    await deposit(brandA, IDS.brandAOwner, 500_000);
    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });
    const transitBefore = await balanceOf("payout_in_transit");

    const requested = await requestWd(IDS.brandAOwner, "authenticated", brandA, 200_000, "+255 712 345 678");
    firstReference = requested.reference;
    expect(requested.reference).toMatch(/^BW[0-9A-F]{16}$/);
    expect(requested.destination).toBe("255712345678");
    expect(requested.status).toBe("requested");

    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore - 200_000);
    expect(await balanceOf("payout_in_transit")).toBe(transitBefore + 200_000);

    const selcomBefore = await balanceOf("selcom_holdings");
    const txn = await confirmWd(firstReference, "SEL-BW-1");
    expect(await balanceOf("selcom_holdings")).toBe(selcomBefore - 200_000);
    expect(await balanceOf("payout_in_transit")).toBe(transitBefore);

    expect(await confirmWd(firstReference, "SEL-BW-1")).toBe(txn);
    expect(await balanceOf("selcom_holdings")).toBe(selcomBefore - 200_000);
    await expect(confirmWd(firstReference, "SEL-BW-OTHER")).rejects.toThrow(
      /different provider reference/,
    );
    await expect(failWd(firstReference)).rejects.toThrow(/confirmed withdrawal cannot be failed/);
  });

  it("refuses anyone but the owner and anything invalid", async () => {
    for (const userId of [IDS.brandAManager, IDS.brandAViewer, IDS.creator1, IDS.brandBOwner]) {
      await expect(requestWd(userId, "authenticated", brandA, 5_000)).rejects.toThrow(
        /only the brand owner/,
      );
    }
    await expect(requestWd(null, "anon", brandA, 5_000)).rejects.toThrow(/permission denied/);

    await expect(requestWd(IDS.brandAOwner, "authenticated", brandA, 999)).rejects.toThrow(
      /withdrawal amount must be between/,
    );
    await expect(requestWd(IDS.brandAOwner, "authenticated", brandA, 50_000_001)).rejects.toThrow(
      /withdrawal amount must be between/,
    );
    for (const bad of ["12345", "0512345678", "+254712345678", ""]) {
      await expect(requestWd(IDS.brandAOwner, "authenticated", brandA, 5_000, bad)).rejects.toThrow(
        /valid Tanzanian mobile number/,
      );
    }
    await expect(requestWd(IDS.brandBOwner, "authenticated", brandB, 5_000)).rejects.toThrow(
      /insufficient wallet balance/,
    );
  });

  it("limits open withdrawals, and a failure returns the money", async () => {
    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });
    const open: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      open.push((await requestWd(IDS.brandAOwner, "authenticated", brandA, 1_000)).reference);
    }
    await expect(requestWd(IDS.brandAOwner, "authenticated", brandA, 1_000)).rejects.toThrow(
      /too many open withdrawals/,
    );
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore - 5_000);

    for (const reference of open) {
      expect(await failWd(reference)).toBe("failed");
      expect(await failWd(reference)).toBe("failed");
    }
    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore);

    await expect(confirmWd(open[0]!, "SEL-BW-LATE")).rejects.toThrow(/marked failed/);
    await expect(confirmWd(open[1]!, "  ")).rejects.toThrow(/provider reference is required/);
    await expect(confirmWd("BWNOSUCHREFERENCE", "SEL-X")).rejects.toThrow(/unknown withdrawal reference/);
  });

  it("refuses one Selcom payment settling two withdrawals", async () => {
    const first = await requestWd(IDS.brandAOwner, "authenticated", brandA, 10_000);
    const second = await requestWd(IDS.brandAOwner, "authenticated", brandA, 10_000);

    await confirmWd(first.reference, "SEL-BW-DUP");
    const transitBefore = await balanceOf("payout_in_transit");

    await expect(confirmWd(second.reference, "SEL-BW-DUP")).rejects.toThrow(/duplicate key|unique/);
    expect(await balanceOf("payout_in_transit")).toBe(transitBefore);
    expect(await failWd(second.reference)).toBe("failed");
  });

  it("shows withdrawals only to the brand's members, and keeps them immutable", async () => {
    await actAs(db, IDS.brandAViewer, "authenticated");
    const listed = await rows<{ reference: string }>(
      db,
      "select * from public.list_brand_withdrawals($1::uuid)",
      [brandA],
    );
    expect(listed.some((r) => r.reference === firstReference)).toBe(true);

    for (const userId of [IDS.brandBOwner, IDS.creator1]) {
      await actAs(db, userId, "authenticated");
      await expect(
        db.query("select * from public.list_brand_withdrawals($1::uuid)", [brandA]),
      ).rejects.toThrow(/not allowed to view/);
    }
    await actAs(db, null, "anon");
    await expect(
      db.query("select * from public.list_brand_withdrawals($1::uuid)", [brandA]),
    ).rejects.toThrow(/permission denied/);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(db.query("select * from ledger.brand_withdrawals")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.close_due_campaigns()")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.confirm_brand_withdrawal('x', 'y')")).rejects.toThrow(
      /permission denied/,
    );

    await asPostgres(db);
    const confirmed = await one<{ id: string }>(
      db,
      "select id from ledger.brand_withdrawals where status = 'confirmed' limit 1",
    );
    await expect(
      db.query("update ledger.brand_withdrawals set amount = amount + 1 where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/withdrawal details cannot change/);
    await expect(
      db.query("update ledger.brand_withdrawals set status = 'requested' where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/invalid withdrawal status change/);
    await expect(
      db.query("delete from ledger.brand_withdrawals where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(db.query("delete from ledger.campaign_closures")).rejects.toThrow(/append-only/);
  });

  it("keeps the ledger consistent after all of it", async () => {
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