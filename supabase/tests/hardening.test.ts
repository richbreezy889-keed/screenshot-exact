import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actAs,
  asPostgres,
  IDS,
  one,
  openDatabase,
  rows,
  seedIdentity,
  type Db,
} from "./support/db";
import {
  applyToCampaign,
  approveApplication,
  checkpointFor,
  createCampaign,
  publishCampaign,
  seedExtraCreators,
  submitVideo,
} from "./support/campaigns";

// Attack tests: each one tries an exploit as the real API role and asserts it
// is rejected, next to a test that the legitimate path still works.

let db: Db;
let brandA: string;
let brandB: string;
const PROOF = "https://example.com/proof.png";

beforeAll(async () => {
  db = await openDatabase();
  ({ brandA, brandB } = await seedIdentity(db));
  await seedExtraCreators(db);
});

afterAll(async () => {
  await db.close();
});

async function liveCampaign(title: string, extra: Parameters<typeof createCampaign>[2] = {}) {
  const campaign = await createCampaign(db, brandA, { title, ...extra });
  await publishCampaign(db, campaign.id);
  return campaign;
}

async function approvedApplication(title: string, creator = IDS.creator1) {
  const campaign = await liveCampaign(title, { creators: 3 });
  const application = await applyToCampaign(db, campaign.id, creator);
  await approveApplication(db, application.id);
  return { campaign, application };
}

describe("applications cannot be self-approved", () => {
  it("rejects a creator inserting an application as approved", async () => {
    const campaign = await liveCampaign("Attack: insert approved");
    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query(
        "insert into public.applications (campaign_id, creator_id, status) values ($1, $2, 'approved')",
        [campaign.id, IDS.creator1],
      ),
    ).rejects.toThrow(/row-level security|must start as applied/);
    // Forged reviewer fields are wiped by the guard, so the row is a plain application.
    const forged = await db.query(
      "insert into public.applications (campaign_id, creator_id, reviewed_by, reviewed_at) values ($1, $2, $2, now()) returning status, reviewed_by, reviewed_at",
      [campaign.id, IDS.creator1],
    );
    expect(forged.rows[0]).toMatchObject({ status: "applied", reviewed_by: null, reviewed_at: null });
  });

  it("still lets a creator apply normally as applied", async () => {
    const campaign = await liveCampaign("Legit apply");
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    expect(application.status).toBe("applied");
  });

  it("does not let a rejected or approved creator set the application back to applied", async () => {
    const campaign = await liveCampaign("Attack: status reversal", { creators: 3 });
    const rejectedApp = await applyToCampaign(db, campaign.id, IDS.creator1);
    const approvedApp = await applyToCampaign(db, campaign.id, IDS.creator2);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await db.query("update public.applications set status = 'rejected' where id = $1", [rejectedApp.id]);
    await approveApplication(db, approvedApp.id);

    await actAs(db, IDS.creator1, "authenticated");
    const fromRejected = await db.query(
      "update public.applications set status = 'applied' where id = $1 returning id",
      [rejectedApp.id],
    );
    expect(fromRejected.rows).toHaveLength(0);

    await actAs(db, IDS.creator2, "authenticated");
    await expect(
      db.query("update public.applications set status = 'applied' where id = $1", [approvedApp.id]),
    ).rejects.toThrow(/row-level security|can only withdraw/);
  });

  it("only lets a creator withdraw an approved application before any video exists", async () => {
    const { campaign, application } = await approvedApplication("Withdraw rules");
    await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
    });

    await actAs(db, IDS.creator1, "authenticated");
    const blocked = await db.query(
      "update public.applications set status = 'withdrawn' where id = $1 returning id",
      [application.id],
    );
    expect(blocked.rows).toHaveLength(0);

    const other = await approvedApplication("Withdraw ok", IDS.creator2);
    await actAs(db, IDS.creator2, "authenticated");
    const allowed = await db.query(
      "update public.applications set status = 'withdrawn' where id = $1 returning status",
      [other.application.id],
    );
    expect(allowed.rows[0]).toMatchObject({ status: "withdrawn" });
  });

  it("does not let a brand do anything but approve or reject a waiting application", async () => {
    const campaign = await liveCampaign("Brand transitions", { creators: 3 });
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("update public.applications set status = 'withdrawn' where id = $1", [application.id]),
    ).rejects.toThrow(/can only approve or reject/);
    await expect(
      db.query("update public.applications set pitch = 'edited by brand' where id = $1", [application.id]),
    ).rejects.toThrow(/cannot edit the creator pitch/);
  });

  it("does not let a creator delete an approved application", async () => {
    const { application } = await approvedApplication("Delete approved");
    await actAs(db, IDS.creator1, "authenticated");
    const deleted = await db.query("delete from public.applications where id = $1 returning id", [
      application.id,
    ]);
    expect(deleted.rows).toHaveLength(0);
  });
});

describe("submissions cannot be self-approved or backdated", () => {
  it("rejects a creator inserting a submission as approved", async () => {
    const { campaign, application } = await approvedApplication("Attack: submission approved");
    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query(
        `insert into public.submissions
           (application_id, campaign_id, creator_id, platform, video_url, posted_at, status)
         values ($1, $2, $3, 'tiktok', 'https://example.com/self-approved', now(), 'approved')`,
        [application.id, campaign.id, IDS.creator1],
      ),
    ).rejects.toThrow(/row-level security|must start as awaiting/);
  });

  it("rejects a future posted_at and a posted_at before the approval", async () => {
    const { campaign, application } = await approvedApplication("Attack: posted_at");
    const insert = (postedAt: string) =>
      db.query(
        `insert into public.submissions
           (application_id, campaign_id, creator_id, platform, video_url, posted_at)
         values ($1, $2, $3, 'tiktok', $4, $5::timestamptz)`,
        [application.id, campaign.id, IDS.creator1, `https://example.com/${crypto.randomUUID()}`, postedAt],
      );

    await actAs(db, IDS.creator1, "authenticated");
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await expect(insert(future)).rejects.toThrow(/cannot be in the future/);
    await expect(insert(past)).rejects.toThrow(/earlier than the approval/);
    await expect(insert(new Date().toISOString())).resolves.toBeDefined();
  });

  it("does not let a creator move posted_at, nor a brand change the video link", async () => {
    const { campaign, application } = await approvedApplication("Attack: edit submission");
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
    });

    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("update public.submissions set posted_at = posted_at - interval '6 days' where id = $1", [
        submission.id,
      ]),
    ).rejects.toThrow(/only an admin can change posted_at/);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("update public.submissions set video_url = 'https://example.com/other' where id = $1", [
        submission.id,
      ]),
    ).rejects.toThrow(/cannot change the video link/);
  });

  it("only lets the brand move a waiting video to approved, revision or rejected", async () => {
    const { campaign, application } = await approvedApplication("Brand review rules");
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
    });
    await actAs(db, IDS.brandAOwner, "authenticated");
    const approved = await db.query(
      "update public.submissions set status = 'approved' where id = $1 returning status, reviewed_by",
      [submission.id],
    );
    expect(approved.rows[0]).toMatchObject({ status: "approved", reviewed_by: IDS.brandAOwner });
    await expect(
      db.query("update public.submissions set status = 'revision' where id = $1", [submission.id]),
    ).rejects.toThrow(/can only approve, reject or request revision of a waiting video/);
  });

  it("locks the application row before counting videos (cap check)", async () => {
    // PGlite is single-connection, so a real race cannot run here; the hosted
    // run must prove it. This asserts the lock is in the function source.
    const def = await one<{ def: string }>(
      db,
      "select pg_get_functiondef('public.enforce_submission_rules'::regproc) as def",
    );
    expect(def!.def.toLowerCase()).toMatch(/where a\.id = new\.application_id\s+for update/);
  });
});

describe("campaign status and deletion are controlled", () => {
  const insertCampaign = (status: string) =>
    db.query(
      `insert into public.campaigns
         (brand_id, title, status, platforms, rate_per_1k, budget, creators_needed, deadline)
       values ($1, 'Direct insert', $2::public.campaign_status, '{tiktok}', 4000, 1000000, 2, '2026-12-31')`,
      [brandA, status],
    );

  it("rejects inserting a campaign as live or paused, accepts draft", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(insertCampaign("live")).rejects.toThrow(/row-level security|can only be created as draft/);
    await expect(insertCampaign("paused")).rejects.toThrow(/row-level security|can only be created as draft/);
    await expect(insertCampaign("draft")).resolves.toBeDefined();
  });

  it("rejects a brand flipping a draft to live or cancelling a live campaign", async () => {
    const draft = await createCampaign(db, brandA, { title: "Flip me" });
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("update public.campaigns set status = 'live' where id = $1", [draft.id]),
    ).rejects.toThrow(/status can only be changed by the platform/);

    const live = await liveCampaign("Cancel me");
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("update public.campaigns set status = 'cancelled' where id = $1", [live.id]),
    ).rejects.toThrow(/status can only be changed by the platform/);
    await expect(
      db.query("update public.campaigns set published_at = null where id = $1", [live.id]),
    ).rejects.toThrow(/published_at can only be changed by the platform/);
  });

  it("only lets an owner delete a draft nobody applied to", async () => {
    const live = await liveCampaign("Do not delete me");
    const draft = await createCampaign(db, brandA, { title: "Delete me" });

    await actAs(db, IDS.brandAManager, "authenticated");
    expect(
      (await db.query("delete from public.campaigns where id = $1 returning id", [draft.id])).rows,
    ).toHaveLength(0);

    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(
      (await db.query("delete from public.campaigns where id = $1 returning id", [live.id])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("delete from public.campaigns where id = $1 returning id", [draft.id])).rows,
    ).toHaveLength(1);
  });

  it("lets only an admin delete a brand", async () => {
    await actAs(db, IDS.brandBOwner, "authenticated");
    expect(
      (await db.query("delete from public.brands where id = $1 returning id", [brandB])).rows,
    ).toHaveLength(0);
  });

  it("keeps videos per creator between 1 and 3 with a default of 1", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const base = (videos: string) =>
      db.query(
        `insert into public.campaigns
           (brand_id, title, platforms, rate_per_1k, budget, creators_needed, deadline${videos ? ", videos_per_creator" : ""})
         values ($1, 'Videos', '{tiktok}', 4000, 1000000, 2, '2026-12-31'${videos ? `, ${videos}` : ""})
         returning videos_per_creator`,
        [brandA],
      );
    await expect(base("4")).rejects.toThrow(/videos_per_creator/);
    await expect(base("0")).rejects.toThrow(/videos_per_creator/);
    expect((await base("3")).rows[0]).toMatchObject({ videos_per_creator: 3 });
    expect((await base("")).rows[0]).toMatchObject({ videos_per_creator: 1 });
  });

  it("shows open slots in campaigns_public without budget", async () => {
    const campaign = await liveCampaign("Open slots", { creators: 3 });
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await approveApplication(db, application.id);

    await actAs(db, IDS.creator2, "authenticated");
    const row = await one<Record<string, unknown>>(
      db,
      "select * from public.campaigns_public where id = $1",
      [campaign.id],
    );
    expect(row).toMatchObject({ creators_needed: 3, open_slots: 2, videos_per_creator: 1 });
    expect(Object.keys(row!)).not.toContain("budget");
    expect(Object.keys(row!)).not.toContain("creator_cap");
  });
});

describe("platform settings drive the rules", () => {
  it("uses a 15% fee and the designed defaults", async () => {
    const settings = await one<Record<string, unknown>>(db, "select * from public.platform_settings");
    expect(settings).toMatchObject({
      fee_bps: 1500,
      min_rate_per_1k: 2000,
      checkpoint_days: 7,
      min_topup: 10000,
      review_hours: 48,
      max_videos_per_creator: 3,
    });
    expect(Object.keys(settings!)).not.toContain("min_payout_tzs");
  });

  it("derives the checkpoint date from checkpoint_days", async () => {
    await actAs(db, IDS.admin, "authenticated");
    await db.query("update public.platform_settings set checkpoint_days = 3 where id");
    const { campaign, application } = await approvedApplication("Checkpoint days");
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      postedAt: "2026-10-01T10:00:00Z",
    });
    const checkpoint = await checkpointFor(db, submission.id);
    expect(new Date(checkpoint!.checkpoint_at).toISOString()).toBe("2026-10-04T10:00:00.000Z");
    await actAs(db, IDS.admin, "authenticated");
    await db.query("update public.platform_settings set checkpoint_days = 7 where id");
  });

  it("does not let a brand or creator change settings", async () => {
    for (const actor of [IDS.brandAOwner, IDS.creator1]) {
      await actAs(db, actor, "authenticated");
      const changed = await db.query("update public.platform_settings set fee_bps = 0 returning id");
      expect(changed.rows).toHaveLength(0);
    }
  });

  it("does not let a campaign exceed the platform maximum of videos", async () => {
    await actAs(db, IDS.admin, "authenticated");
    await db.query("update public.platform_settings set max_videos_per_creator = 2 where id");
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(createCampaign(db, brandA, { title: "Too many videos", maxVideos: 3 })).rejects.toThrow(
      /videos_per_creator cannot exceed 2/,
    );
    await actAs(db, IDS.admin, "authenticated");
    await db.query("update public.platform_settings set max_videos_per_creator = 3 where id");
  });
});

describe("creators", () => {
  it("does not let a creator set their own rating or past campaigns", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("update public.creators set rating = 5 where id = $1", [IDS.creator1]),
    ).rejects.toThrow(/set by the platform/);
    await expect(
      db.query("update public.creators set past_campaigns = 99 where id = $1", [IDS.creator1]),
    ).rejects.toThrow(/set by the platform/);
    const ok = await db.query(
      "update public.creators set bio = 'new bio' where id = $1 returning bio",
      [IDS.creator1],
    );
    expect(ok.rows).toHaveLength(1);

    await actAs(db, IDS.admin, "authenticated");
    const admin = await db.query(
      "update public.creators set rating = 4.5 where id = $1 returning rating",
      [IDS.creator1],
    );
    expect(admin.rows).toHaveLength(1);
  });

  it("does not let a new creator start with a rating", async () => {
    await asPostgres(db);
    const id = "00000000-0000-4000-8000-0000000000aa";
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'new@biboh.test', $2::jsonb)", [
      id,
      JSON.stringify({ role: "creator" }),
    ]);
    await actAs(db, id, "authenticated");
    await expect(
      db.query("insert into public.creators (id, display_name, handle, rating) values ($1, 'New', '@newone', 5)", [id]),
    ).rejects.toThrow(/set by the platform/);
  });

  it("requires a unique handle, ignoring case", async () => {
    await asPostgres(db);
    await expect(
      db.query("update public.creators set handle = upper(handle) where id = $1", [IDS.creator2]),
    ).resolves.toBeDefined();
    await expect(
      db.query("update public.creators set handle = '@CREATORTWO' where id = $1", [IDS.creator1]),
    ).rejects.toThrow(/duplicate key|unique/);
    await expect(
      db.query("update public.creators set handle = null where id = $1", [IDS.creator1]),
    ).rejects.toThrow(/null value|not-null/);
  });
});

describe("view checkpoints need evidence, the date and an admin", () => {
  async function checkpointRow(postedAt: string | undefined) {
    const { campaign, application } = await approvedApplication(`Checkpoint ${postedAt ?? "now"}`);
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      postedAt,
    });
    return (await checkpointFor(db, submission.id))!;
  }

  it("rejects verifying without evidence", async () => {
    const checkpoint = await checkpointRow("2026-10-01T10:00:00Z");
    await actAs(db, IDS.admin, "authenticated");
    await expect(
      db.query("update public.view_checkpoints set status = 'verified', views = 100 where id = $1", [checkpoint.id]),
    ).rejects.toThrow(/evidence_url is required/);
  });

  it("rejects verifying before the checkpoint date", async () => {
    const checkpoint = await checkpointRow(undefined);
    await actAs(db, IDS.admin, "authenticated");
    await expect(
      db.query(
        "update public.view_checkpoints set status = 'verified', views = 100, evidence_url = $2 where id = $1",
        [checkpoint.id, PROOF],
      ),
    ).rejects.toThrow(/before its checkpoint date/);
  });

  it("rejects a brand manager verifying and a service-free creator editing", async () => {
    const checkpoint = await checkpointRow("2026-10-01T10:00:00Z");
    for (const actor of [IDS.brandAOwner, IDS.brandAManager, IDS.creator1]) {
      await actAs(db, actor, "authenticated");
      const result = await db.query(
        "update public.view_checkpoints set status = 'verified', views = 100, evidence_url = $2 where id = $1 returning id",
        [checkpoint.id, PROOF],
      );
      expect(result.rows).toHaveLength(0);
    }
    await asPostgres(db);
    expect((await checkpointFor(db, checkpoint.id))?.status ?? "pending").toBe("pending");
  });

  it("lets an admin verify with evidence, records who, and then locks every field", async () => {
    const checkpoint = await checkpointRow("2026-10-01T10:00:00Z");
    await actAs(db, IDS.admin, "authenticated");
    const verified = await db.query(
      "update public.view_checkpoints set status = 'verified', views = 12345, evidence_url = $2 where id = $1 returning status, verified_by, verified_at",
      [checkpoint.id, PROOF],
    );
    expect(verified.rows[0]).toMatchObject({ status: "verified", verified_by: IDS.admin });
    expect(verified.rows[0]!.verified_at).toBeTruthy();

    await expect(
      db.query("update public.view_checkpoints set evidence_url = 'https://example.com/other.png' where id = $1", [
        checkpoint.id,
      ]),
    ).rejects.toThrow(/verified checkpoints are immutable/);
    await expect(
      db.query("update public.view_checkpoints set views = 1 where id = $1", [checkpoint.id]),
    ).rejects.toThrow(/verified checkpoints are immutable/);
  });
});

describe("brand team management is owner-only", () => {
  it("rejects a manager adding or promoting members", async () => {
    await actAs(db, IDS.brandAManager, "authenticated");
    await expect(
      db.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'manager')", [
        brandA,
        IDS.outsider,
      ]),
    ).rejects.toThrow(/row-level security/);
    const promote = await db.query(
      "update public.brand_members set role = 'manager' where brand_id = $1 and user_id = $2 returning role",
      [brandA, IDS.brandAViewer],
    );
    expect(promote.rows).toHaveLength(0);
  });

  it("lets the owner add a member but never a second owner", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const added = await db.query(
      "insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'viewer') returning role",
      [brandA, IDS.outsider],
    );
    expect(added.rows).toHaveLength(1);
    await expect(
      db.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [
        brandA,
        IDS.creator2,
      ]),
    ).rejects.toThrow(/row-level security|duplicate key/);
  });
});

describe("new tables and functions start closed", () => {
  it("gives anon and authenticated no default access to a new table or function", async () => {
    await asPostgres(db);
    await db.exec("create table public.zz_probe (id int); create function public.zz_probe_fn() returns int language sql as 'select 1';");

    const priv = async (role: string, kind: "select" | "insert" | "update" | "delete") =>
      (await one<{ ok: boolean }>(db, `select has_table_privilege('${role}', 'public.zz_probe', '${kind}') as ok`))!.ok;
    for (const role of ["anon", "authenticated"]) {
      for (const kind of ["select", "insert", "update", "delete"] as const) {
        expect(await priv(role, kind)).toBe(false);
      }
      const fn = await one<{ ok: boolean }>(
        db,
        `select has_function_privilege('${role}', 'public.zz_probe_fn()', 'execute') as ok`,
      );
      expect(fn!.ok).toBe(false);
    }
    expect(await priv("service_role", "select")).toBe(true);

    await db.exec("drop table public.zz_probe; drop function public.zz_probe_fn();");
  });

  it("lists no anon privileges on any existing table or view", async () => {
    const granted = await rows<{ table_name: string; privilege_type: string }>(
      db,
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(granted).toEqual([]);
  });
});
