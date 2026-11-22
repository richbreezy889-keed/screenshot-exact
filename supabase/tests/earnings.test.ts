import { beforeAll, describe, expect, it } from "vitest";
import {
  applyToCampaign,
  approveApplication,
  createCampaign,
  publishCampaign,
  submitVideo,
  type CampaignRow,
} from "./support/campaigns";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Accrual = {
  id: string;
  status: string;
  gross: string | number;
  fee: string | number;
  net: string | number;
  release_at: string;
  campaign_id: string;
};

const BASE = { budget: 1_000_000, creators: 2, rate: 4000, maxVideos: 2 };

describe("funding, earnings, the hold and flags (phase 2b)", () => {
  let db: Db;
  let brandA: string;
  let brandB: string;
  let feeBps = 0;
  let reviewHours = 0;
  let depositSeq = 0;

  const feeOf = (gross: number) => Math.floor((gross * feeBps + 5000) / 10000);

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
      `SEL-EARN-${depositSeq}`,
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

  async function publish(campaignId: string, userId: string | null = IDS.brandAOwner) {
    await actAs(db, userId, userId ? "authenticated" : "anon");
    const result = await one<{ id: string }>(
      db,
      "select public.publish_campaign($1::uuid) as id",
      [campaignId],
    );
    return result!.id;
  }

  async function fundedCampaign(title: string, overrides: Partial<typeof BASE> = {}) {
    const options = { ...BASE, ...overrides, title };
    const campaign = await createCampaign(db, brandA, options);
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

  async function accrualOf(submissionId: string): Promise<Accrual | null> {
    await asPostgres(db);
    return one<Accrual>(
      db,
      `select a.* from ledger.checkpoint_accruals a
       join public.view_checkpoints v on v.id = a.checkpoint_id
       where v.submission_id = $1`,
      [submissionId],
    );
  }

  async function verifiedAccrual(title: string, views: number) {
    const campaign = await fundedCampaign(title);
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(application.id, campaign.id, IDS.creator1);
    await verify(video.id, views);
    const accrual = await accrualOf(video.id);
    expect(accrual).not.toBeNull();
    return { campaign, application, video, accrual: accrual! };
  }

  async function releaseDue(): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ n: string | number | bigint }>(
      db,
      "select public.release_due_accruals() as n",
    );
    return Number(result!.n);
  }

  async function backdate(accrualId: string) {
    await asPostgres(db);
    await db.query(
      "update ledger.checkpoint_accruals set release_at = now() - interval '1 minute' where id = $1",
      [accrualId],
    );
  }

  async function flag(userId: string, accrualId: string, reason: string): Promise<string> {
    await actAs(db, userId, "authenticated");
    const result = await one<{ s: string }>(
      db,
      "select public.flag_accrual($1::uuid, $2::text) as s",
      [accrualId, reason],
    );
    return result!.s;
  }

  async function resolve(
    userId: string,
    accrualId: string,
    decision: string,
    note: string,
  ): Promise<string> {
    await actAs(db, userId, "authenticated");
    const result = await one<{ s: string }>(
      db,
      "select public.resolve_accrual_flag($1::uuid, $2::text, $3::text) as s",
      [accrualId, decision, note],
    );
    return result!.s;
  }

  beforeAll(async () => {
    db = await openDatabase();
    const ids = await seedIdentity(db);
    brandA = ids.brandA;
    brandB = ids.brandB;

    await asPostgres(db);
    const settings = await one<{ fee_bps: number; review_hours: number }>(
      db,
      "select fee_bps, review_hours from public.platform_settings where id = true",
    );
    feeBps = Number(settings!.fee_bps);
    reviewHours = Number(settings!.review_hours);
  });

  it("publishing moves the budget from the wallet to escrow and records the terms", async () => {
    const campaign = await createCampaign(db, brandA, { ...BASE, title: "Funding" });
    await deposit(brandA, IDS.brandAOwner, 1_000_000);
    const walletBefore = await balanceOf("brand_wallet", { brand: brandA });

    await publish(campaign.id);

    expect(await balanceOf("brand_wallet", { brand: brandA })).toBe(walletBefore - 1_000_000);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(1_000_000);

    await asPostgres(db);
    const state = await one<{ status: string }>(
      db,
      "select status::text as status from public.campaigns where id = $1",
      [campaign.id],
    );
    expect(state!.status).toBe("live");

    const funding = await one<{ fee_bps: number; hold_hours: number; budget: string | number }>(
      db,
      "select fee_bps, hold_hours, budget from ledger.campaign_funding where campaign_id = $1",
      [campaign.id],
    );
    expect(Number(funding!.fee_bps)).toBe(feeBps);
    expect(Number(funding!.hold_hours)).toBe(reviewHours);
    expect(Number(funding!.budget)).toBe(1_000_000);
  });

  it("refuses to publish without enough money, and changes nothing", async () => {
    const campaign = await createCampaign(db, brandB, {
      ...BASE,
      title: "Underfunded",
      actor: IDS.brandBOwner,
    });

    await expect(publish(campaign.id, IDS.brandBOwner)).rejects.toThrow(/insufficient wallet balance/);

    await asPostgres(db);
    const state = await one<{ status: string }>(
      db,
      "select status::text as status from public.campaigns where id = $1",
      [campaign.id],
    );
    expect(state!.status).toBe("draft");
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(0);
  });

  it("only brand owners and managers can publish, and only once", async () => {
    const campaign = await createCampaign(db, brandA, { ...BASE, title: "Publish rules" });
    await deposit(brandA, IDS.brandAOwner, 1_000_000);

    for (const userId of [IDS.brandAViewer, IDS.creator1, IDS.brandBOwner]) {
      await expect(publish(campaign.id, userId)).rejects.toThrow(/not allowed to publish/);
    }
    await expect(publish(campaign.id, null)).rejects.toThrow(/permission denied/);

    await publish(campaign.id, IDS.brandAManager);
    await expect(publish(campaign.id)).rejects.toThrow(/only a draft campaign/);
  });

  it("a verified checkpoint credits the creator, the fee and escrow in one step", async () => {
    const campaign = await fundedCampaign("Accrual");
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(application.id, campaign.id, IDS.creator1);

    const before = {
      escrow: await balanceOf("campaign_escrow", { campaign: campaign.id }),
      pending: await balanceOf("creator_pending", { creator: IDS.creator1 }),
      fees: await balanceOf("platform_fees"),
    };

    await verify(video.id, 10_000);

    const gross = 40_000;
    const fee = feeOf(gross);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(before.escrow - gross);
    expect(await balanceOf("creator_pending", { creator: IDS.creator1 })).toBe(
      before.pending + gross - fee,
    );
    expect(await balanceOf("platform_fees")).toBe(before.fees + fee);

    const accrual = await accrualOf(video.id);
    expect(accrual!.status).toBe("held");
    expect(Number(accrual!.gross)).toBe(gross);
    expect(Number(accrual!.fee)).toBe(fee);
    expect(Number(accrual!.net)).toBe(gross - fee);
    expect(new Date(accrual!.release_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("one creator's videos share a single cap", async () => {
    const campaign = await fundedCampaign("Shared cap");
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const first = await postVideo(application.id, campaign.id, IDS.creator1);
    const second = await postVideo(application.id, campaign.id, IDS.creator1);

    await verify(first.id, 100_000);
    await verify(second.id, 100_000);

    const a = await accrualOf(first.id);
    const b = await accrualOf(second.id);
    expect(Number(a!.gross)).toBe(400_000);
    expect(Number(b!.gross)).toBe(100_000);
    expect(Number(a!.gross) + Number(b!.gross)).toBe(500_000);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(500_000);
  });

  it("pays exact whole shillings and rounds the fee to the nearest shilling", async () => {
    const campaign = await fundedCampaign("Rounding", { rate: 2000 });
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(application.id, campaign.id, IDS.creator1);

    await verify(video.id, 1001);

    const accrual = await accrualOf(video.id);
    expect(Number(accrual!.gross)).toBe(2002);
    expect(Number(accrual!.fee)).toBe(feeOf(2002));
    expect(Number(accrual!.net)).toBe(2002 - feeOf(2002));
  });

  it("a rejected video earns nothing", async () => {
    const campaign = await fundedCampaign("Rejected");
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(application.id, campaign.id, IDS.creator1);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await db.query("update public.submissions set status = 'rejected' where id = $1", [video.id]);

    const escrowBefore = await balanceOf("campaign_escrow", { campaign: campaign.id });
    await verify(video.id, 50_000);

    const accrual = await accrualOf(video.id);
    expect(accrual!.status).toBe("void");
    expect(Number(accrual!.gross)).toBe(0);
    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(escrowBefore);
  });

  it("campaigns published before the ledger are left alone", async () => {
    const campaign = await createCampaign(db, brandA, { ...BASE, title: "Legacy" });
    await publishCampaign(db, campaign.id);
    const application = await approvedApplication(campaign.id, IDS.creator1);
    const video = await postVideo(application.id, campaign.id, IDS.creator1);

    await verify(video.id, 10_000);

    expect(await accrualOf(video.id)).toBeNull();
  });

  it("releases a payout only after the hold, and only once", async () => {
    expect(reviewHours, "platform_settings.review_hours must be above zero").toBeGreaterThan(0);

    const { accrual } = await verifiedAccrual("Release", 10_000);
    const net = Number(accrual.net);

    expect(await releaseDue()).toBe(0);
        await asPostgres(db);
    const stillHeld = await one<{ status: string }>(
      db,
      "select status from ledger.checkpoint_accruals where id = $1",
      [accrual.id],
    );
    expect(stillHeld!.status).toBe("held");

    const before = {
      pending: await balanceOf("creator_pending", { creator: IDS.creator1 }),
      payable: await balanceOf("creator_payable", { creator: IDS.creator1 }),
    };

    await backdate(accrual.id);
    expect(await releaseDue()).toBe(1);
    expect(await balanceOf("creator_pending", { creator: IDS.creator1 })).toBe(before.pending - net);
    expect(await balanceOf("creator_payable", { creator: IDS.creator1 })).toBe(before.payable + net);

    expect(await releaseDue()).toBe(0);
    expect(await balanceOf("creator_payable", { creator: IDS.creator1 })).toBe(before.payable + net);
  });

  it("a flagged payout stays frozen until an admin reverses it", async () => {
    const { campaign, accrual } = await verifiedAccrual("Flag and reverse", 10_000);
    const gross = Number(accrual.gross);
    const fee = Number(accrual.fee);
    const net = Number(accrual.net);

    const before = {
      escrow: await balanceOf("campaign_escrow", { campaign: campaign.id }),
      pending: await balanceOf("creator_pending", { creator: IDS.creator1 }),
      fees: await balanceOf("platform_fees"),
    };

    await expect(flag(IDS.brandAOwner, accrual.id, "too short")).rejects.toThrow(/at least 10 characters/);
    await expect(flag(IDS.brandAViewer, accrual.id, "views look inflated by bots")).rejects.toThrow(
      /not allowed to flag/,
    );
    await expect(flag(IDS.creator1, accrual.id, "views look inflated by bots")).rejects.toThrow(
      /not allowed to flag/,
    );

    expect(await flag(IDS.brandAOwner, accrual.id, "views look inflated by bots")).toBe("flagged");
    expect(await flag(IDS.brandAManager, accrual.id, "views look inflated by bots")).toBe("flagged");

    await backdate(accrual.id);
    expect(await releaseDue()).toBe(0);

    await expect(
      resolve(IDS.brandAOwner, accrual.id, "reverse", "the brand cannot decide its own flag"),
    ).rejects.toThrow(/only an admin/);
    await expect(resolve(IDS.admin, accrual.id, "maybe", "not a real decision here")).rejects.toThrow(
      /release or reverse/,
    );
    await expect(resolve(IDS.admin, accrual.id, "reverse", "short")).rejects.toThrow(/at least 10 characters/);

    expect(await resolve(IDS.admin, accrual.id, "reverse", "evidence shows the views were bought")).toBe(
      "reversed",
    );
    expect(await resolve(IDS.admin, accrual.id, "release", "a second decision changes nothing")).toBe(
      "reversed",
    );

    expect(await balanceOf("campaign_escrow", { campaign: campaign.id })).toBe(before.escrow + gross);
    expect(await balanceOf("creator_pending", { creator: IDS.creator1 })).toBe(before.pending - net);
    expect(await balanceOf("platform_fees")).toBe(before.fees - fee);
  });

  it("an admin can release a flagged payout to the creator", async () => {
    const { accrual } = await verifiedAccrual("Flag and release", 10_000);
    const net = Number(accrual.net);

    await flag(IDS.brandAOwner, accrual.id, "we want this looked at again");
    const before = await balanceOf("creator_payable", { creator: IDS.creator1 });

    expect(await resolve(IDS.admin, accrual.id, "release", "evidence checks out, views are real")).toBe(
      "released",
    );
    expect(await balanceOf("creator_payable", { creator: IDS.creator1 })).toBe(before + net);
  });

  it("a payout cannot be flagged once its review period has ended", async () => {
    const { accrual } = await verifiedAccrual("Late flag", 10_000);

    await backdate(accrual.id);
    await expect(flag(IDS.brandAOwner, accrual.id, "this comes in too late")).rejects.toThrow(
      /review period/,
    );

    expect(await releaseDue()).toBeGreaterThanOrEqual(1);
    await expect(flag(IDS.brandAOwner, accrual.id, "this comes in too late")).rejects.toThrow(
      /no longer open/,
    );
  });

  it("shows payouts only to the people they concern", async () => {
    const { campaign, accrual } = await verifiedAccrual("Reads", 10_000);

    await actAs(db, IDS.creator1, "authenticated");
    const mine = await rows<{ accrual_id: string }>(db, "select * from public.list_my_earnings()");
    expect(mine.some((r) => r.accrual_id === accrual.id)).toBe(true);

    await actAs(db, IDS.creator2, "authenticated");
    const theirs = await rows<{ accrual_id: string }>(db, "select * from public.list_my_earnings()");
    expect(theirs.some((r) => r.accrual_id === accrual.id)).toBe(false);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const brandView = await rows<{ accrual_id: string }>(
      db,
      "select * from public.list_campaign_accruals($1::uuid)",
      [campaign.id],
    );
    expect(brandView.some((r) => r.accrual_id === accrual.id)).toBe(true);

    for (const userId of [IDS.brandBOwner, IDS.brandAViewer, IDS.creator1]) {
      await actAs(db, userId, "authenticated");
      await expect(
        db.query("select * from public.list_campaign_accruals($1::uuid)", [campaign.id]),
      ).rejects.toThrow(/not allowed to view/);
    }

    await actAs(db, null, "anon");
    await expect(db.query("select * from public.list_my_earnings()")).rejects.toThrow(/permission denied/);
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(db.query("select public.release_due_accruals()")).rejects.toThrow(/permission denied/);
  });

  it("keeps accruals immutable", async () => {
    const { accrual } = await verifiedAccrual("Immutable", 10_000);

    await asPostgres(db);
    await expect(
      db.query("update ledger.checkpoint_accruals set gross = gross + 1 where id = $1", [accrual.id]),
    ).rejects.toThrow(/accrual details cannot change/);
    await expect(
      db.query("update ledger.checkpoint_accruals set release_at = release_at + interval '1 day' where id = $1", [
        accrual.id,
      ]),
    ).rejects.toThrow(/accrual details cannot change/);
    await expect(
      db.query("update ledger.checkpoint_accruals set status = 'reversed' where id = $1", [accrual.id]),
    ).rejects.toThrow(/invalid accrual status change/);
    await expect(
      db.query("delete from ledger.checkpoint_accruals where id = $1", [accrual.id]),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(db.query("delete from ledger.campaign_funding")).rejects.toThrow(/append-only/);
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