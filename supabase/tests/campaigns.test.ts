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
  EXTRA_CREATOR_IDS,
  publishCampaign,
  seedExtraCreators,
  submitVideo,
} from "./support/campaigns";

let db: Db;
let brandA: string;
let brandB: string;
let extras: string[];

beforeAll(async () => {
  db = await openDatabase();
  ({ brandA, brandB } = await seedIdentity(db));
  extras = await seedExtraCreators(db);
});

afterAll(async () => {
  await db.close();
});

describe("campaign schema", () => {
  it("enables RLS on every campaign table", async () => {
    const found = await rows<{ name: string; rls: boolean }>(
      db,
      `select c.relname as name, c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relname in ('campaigns','applications','submissions','view_checkpoints')
       order by c.relname`,
    );
    expect(found.map((row) => row.name)).toEqual([
      "applications",
      "campaigns",
      "submissions",
      "view_checkpoints",
    ]);
    expect(found.every((row) => row.rls)).toBe(true);
  });

  it("keeps budget and creator cap out of the public view", async () => {
    const columns = await rows<{ column_name: string }>(
      db,
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'campaigns_public'
       order by ordinal_position`,
    );
    const names = columns.map((row) => row.column_name);
    expect(names).not.toContain("budget");
    expect(names).not.toContain("creator_cap");
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "brand_id",
        "brand_name",
        "title",
        "rate_per_1k",
        "creators_needed",
        "deadline",
      ]),
    );
  });
});

describe("campaign terms", () => {
  it("enforces the platform minimum rate of 2,000 TZS", async () => {
    await expect(
      createCampaign(db, brandA, { title: "Rate 1999", rate: 1999 }),
    ).rejects.toThrow(/at least 2000/);

    const accepted = await createCampaign(db, brandA, { title: "Rate 2000", rate: 2000 });
    expect(accepted.rate_per_1k).toBe(2000);
  });

  it("derives creator_cap as floor(budget / creators_needed)", async () => {
    const cases = [
      { budget: 5_000_000, creators: 10, expected: 500_000 },
      { budget: 3_000_000, creators: 6, expected: 500_000 },
      { budget: 4_500_000, creators: 12, expected: 375_000 },
      { budget: 2_000_000, creators: 7, expected: 285_714 },
    ];

    for (const testCase of cases) {
      const campaign = await createCampaign(db, brandA, {
        title: `Cap ${testCase.budget}/${testCase.creators}`,
        budget: testCase.budget,
        creators: testCase.creators,
      });
      expect(campaign.creator_cap).toBe(testCase.expected);
    }
  });

  it("makes terms immutable once the campaign is live", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Terms Campaign" });
    await publishCampaign(db, campaign.id);
    await actAs(db, IDS.brandAOwner, "authenticated");

    const changes = [
      "rate_per_1k = 5000",
      "budget = 3000000",
      "creators_needed = 9",
      "max_videos_per_creator = 1",
      "platforms = '{instagram}'::public.social_platform[]",
      "deadline = '2027-01-31'",
    ];

    for (const change of changes) {
      await expect(
        db.query(`update public.campaigns set ${change} where id = $1`, [campaign.id]),
      ).rejects.toThrow(/terms are immutable/);
    }

    const title = await db.query(
      "update public.campaigns set title = 'Terms Campaign Updated' where id = $1 returning title",
      [campaign.id],
    );
    expect(title.rows).toHaveLength(1);

    await expect(
      db.query("update public.campaigns set status = 'draft' where id = $1", [campaign.id]),
    ).rejects.toThrow(/cannot return to draft/);
  });
});

describe("applications", () => {
  it("lets a creator apply to a live campaign and keeps brands isolated", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Apply Campaign" });
    await publishCampaign(db, campaign.id);

    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    expect(application.status).toBe("applied");

    await actAs(db, IDS.creator2, "authenticated");
    expect(await rows(db, "select id from public.applications where id = $1", [application.id])).toHaveLength(0);

    await actAs(db, IDS.brandBOwner, "authenticated");
    expect(await rows(db, "select id from public.applications where id = $1", [application.id])).toHaveLength(0);

    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(await rows(db, "select id from public.applications where id = $1", [application.id])).toHaveLength(1);
  });

  it("does not let a creator approve their own application", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Self Approve" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);

    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("update public.applications set status = 'approved' where id = $1", [application.id]),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the brand approve an application and records the reviewer", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Approve Campaign" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);

    const approved = await approveApplication(db, application.id);
    expect(approved.status).toBe("approved");
    expect(approved.reviewed_by).toBe(IDS.brandAOwner);
  });

  it("does not accept applications on a draft campaign", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Draft Campaign" });
    await expect(applyToCampaign(db, campaign.id, IDS.creator1)).rejects.toThrow(
      /row-level security/,
    );
  });

  it("lets a creator withdraw their own application", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Withdraw Campaign" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator2);

    await actAs(db, IDS.creator2, "authenticated");
    const withdrawn = await db.query(
      "update public.applications set status = 'withdrawn' where id = $1 returning status",
      [application.id],
    );
    expect(withdrawn.rows).toHaveLength(1);
    expect(withdrawn.rows[0]).toMatchObject({ status: "withdrawn" });
  });

  it("rejects the 7th approval when a campaign has 6 slots", async () => {
    const campaign = await createCampaign(db, brandA, {
      title: "Six Slots",
      creators: 6,
    });
    await publishCampaign(db, campaign.id);

    const applicants = [IDS.creator1, IDS.creator2, ...extras.slice(0, 5)];
    const applications = [];
    for (const creatorId of applicants) {
      applications.push(await applyToCampaign(db, campaign.id, creatorId));
    }

    for (const application of applications.slice(0, 6)) {
      const approved = await approveApplication(db, application.id);
      expect(approved.status).toBe("approved");
    }

    await expect(approveApplication(db, applications[6]!.id)).rejects.toThrow(
      /creator cap of 6 reached/,
    );

    await asPostgres(db);
    const approvedCount = await one<{ n: number }>(
      db,
      "select count(*)::int as n from public.applications where campaign_id = $1 and status = 'approved'",
      [campaign.id],
    );
    expect(approvedCount?.n).toBe(6);
  });
});

describe("submissions", () => {
  it("derives a checkpoint and enforces the per-creator video cap", async () => {
    const campaign = await createCampaign(db, brandA, {
      title: "Video Cap Campaign",
      maxVideos: 2,
    });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await approveApplication(db, application.id);

    const first = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      url: "https://example.com/video-1",
      postedAt: "2026-10-01T10:00:00Z",
    });

    const checkpoint = await checkpointFor(db, first.id);
    expect(checkpoint).not.toBeNull();
    expect(new Date(checkpoint!.checkpoint_at).toISOString()).toBe("2026-10-08T10:00:00.000Z");
    expect(checkpoint!.status).toBe("pending");

    await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      url: "https://example.com/video-2",
    });

    await expect(
      submitVideo(db, {
        applicationId: application.id,
        campaignId: campaign.id,
        creatorId: IDS.creator1,
        url: "https://example.com/video-3",
      }),
    ).rejects.toThrow(/submission cap of 2 videos reached/);

    await asPostgres(db);
    const count = await one<{ n: number }>(
      db,
      "select count(*)::int as n from public.submissions where application_id = $1",
      [application.id],
    );
    expect(count?.n).toBe(2);
  });

  it("requires an approved application and matching creator", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Unapproved Submission" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);

    await expect(
      submitVideo(db, {
        applicationId: application.id,
        campaignId: campaign.id,
        creatorId: IDS.creator1,
      }),
    ).rejects.toThrow(/only approved creators/);

    await approveApplication(db, application.id);
    await expect(
      submitVideo(db, {
        applicationId: application.id,
        campaignId: campaign.id,
        creatorId: IDS.creator2,
      }),
    ).rejects.toThrow(/submission must match its application/);
  });

  it("keeps submissions private to the creator and the campaign brand", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Submission Visibility" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await approveApplication(db, application.id);
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
    });

    await actAs(db, IDS.creator1, "authenticated");
    expect(await rows(db, "select id from public.submissions where id = $1", [submission.id])).toHaveLength(1);

    await actAs(db, IDS.creator2, "authenticated");
    expect(await rows(db, "select id from public.submissions where id = $1", [submission.id])).toHaveLength(0);

    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(await rows(db, "select id from public.submissions where id = $1", [submission.id])).toHaveLength(1);

    await actAs(db, IDS.brandBOwner, "authenticated");
    expect(await rows(db, "select id from public.submissions where id = $1", [submission.id])).toHaveLength(0);
  });

  it("lets the brand review a submission but not the creator", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Submission Review" });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await approveApplication(db, application.id);
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      url: "https://example.com/review-me",
    });

    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("update public.submissions set status = 'approved' where id = $1", [submission.id]),
    ).rejects.toThrow(/row-level security/);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const approved = await db.query(
      "update public.submissions set status = 'approved' where id = $1 returning status",
      [submission.id],
    );
    expect(approved.rows).toHaveLength(1);
    expect(approved.rows[0]).toMatchObject({ status: "approved" });
  });
});

describe("view checkpoints", () => {
  async function approvedSubmission(title: string) {
    const campaign = await createCampaign(db, brandA, { title, creators: 3 });
    await publishCampaign(db, campaign.id);
    const application = await applyToCampaign(db, campaign.id, IDS.creator1);
    await approveApplication(db, application.id);
    const submission = await submitVideo(db, {
      applicationId: application.id,
      campaignId: campaign.id,
      creatorId: IDS.creator1,
      url: `https://example.com/${crypto.randomUUID()}`,
      postedAt: "2026-10-01T10:00:00Z",
    });
    const checkpoint = await checkpointFor(db, submission.id);
    return { campaign, application, submission, checkpoint: checkpoint! };
  }

  it("lets an admin verify a checkpoint", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint Verify");

    await actAs(db, IDS.admin, "authenticated");
    const verified = await db.query(
      "update public.view_checkpoints set status = 'verified', views = 5000 where id = $1 returning status, views, verified_by",
      [checkpoint.id],
    );
    expect(verified.rows).toHaveLength(1);
    expect(verified.rows[0]).toMatchObject({
      status: "verified",
      views: 5000,
      verified_by: IDS.admin,
    });
  });

  it("lets no brand role change views_at_checkpoint, status or evidence", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint No Brand Writes");

    for (const actor of [IDS.brandAOwner, IDS.brandAManager, IDS.brandAViewer]) {
      await actAs(db, actor, "authenticated");
      const views = await db.query(
        "update public.view_checkpoints set views = 999 where id = $1 returning views",
        [checkpoint.id],
      );
      expect(views.rows).toHaveLength(0);
      const status = await db.query(
        "update public.view_checkpoints set status = 'verified' where id = $1 returning status",
        [checkpoint.id],
      );
      expect(status.rows).toHaveLength(0);
    }
  });

  it("lets an admin change an unverified checkpoint", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint Admin Change");

    await actAs(db, IDS.admin, "authenticated");
    const updated = await db.query(
      "update public.view_checkpoints set views = 4242 where id = $1 returning views",
      [checkpoint.id],
    );
    expect(updated.rows).toHaveLength(1);
    expect(updated.rows[0]).toMatchObject({ views: 4242 });
  });

  it("keeps a verified checkpoint immutable even for admin", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint Immutable");

    await actAs(db, IDS.admin, "authenticated");
    await db.query(
      "update public.view_checkpoints set status = 'verified', views = 1234 where id = $1",
      [checkpoint.id],
    );

    await expect(
      db.query("update public.view_checkpoints set views = 9999 where id = $1", [checkpoint.id]),
    ).rejects.toThrow(/verified checkpoints are immutable/);

    await expect(
      db.query("update public.view_checkpoints set status = 'rejected' where id = $1", [checkpoint.id]),
    ).rejects.toThrow(/verified checkpoints are immutable/);

    await expect(
      db.query("update public.view_checkpoints set checkpoint_at = now() where id = $1", [checkpoint.id]),
    ).rejects.toThrow(/verified checkpoints are immutable/);
  });

  it("does not let creators or other brands verify checkpoints", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint Authority");

    await actAs(db, IDS.creator1, "authenticated");
    const creatorEdit = await db.query(
      "update public.view_checkpoints set status = 'verified', views = 100 where id = $1 returning id",
      [checkpoint.id],
    );
    expect(creatorEdit.rows).toHaveLength(0);

    await actAs(db, IDS.brandBOwner, "authenticated");
    const otherBrand = await db.query(
      "update public.view_checkpoints set status = 'verified', views = 100 where id = $1 returning id",
      [checkpoint.id],
    );
    expect(otherBrand.rows).toHaveLength(0);
  });

  it("re-derives the checkpoint until it is verified", async () => {
    const { submission, checkpoint } = await approvedSubmission("Checkpoint Rederive");

    await actAs(db, IDS.creator1, "authenticated");
    const moved = await db.query(
      "update public.submissions set posted_at = '2026-10-03T10:00:00Z' where id = $1 returning posted_at",
      [submission.id],
    );
    expect(moved.rows).toHaveLength(1);

    const afterMove = await checkpointFor(db, submission.id);
    expect(new Date(afterMove!.checkpoint_at).toISOString()).toBe("2026-10-10T10:00:00.000Z");

    await actAs(db, IDS.admin, "authenticated");
    await db.query(
      "update public.view_checkpoints set status = 'verified', views = 777 where id = $1",
      [checkpoint.id],
    );

    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("update public.submissions set posted_at = '2026-10-04T10:00:00Z' where id = $1", [
        submission.id,
      ]),
    ).rejects.toThrow(/posted_at cannot change after checkpoint verification/);
  });

  it("is visible to the creator and campaign brand only", async () => {
    const { checkpoint } = await approvedSubmission("Checkpoint Visibility");

    await actAs(db, IDS.creator1, "authenticated");
    expect(await rows(db, "select id from public.view_checkpoints where id = $1", [checkpoint.id])).toHaveLength(1);

    await actAs(db, IDS.creator2, "authenticated");
    expect(await rows(db, "select id from public.view_checkpoints where id = $1", [checkpoint.id])).toHaveLength(0);

    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(await rows(db, "select id from public.view_checkpoints where id = $1", [checkpoint.id])).toHaveLength(1);

    await actAs(db, IDS.brandBOwner, "authenticated");
    expect(await rows(db, "select id from public.view_checkpoints where id = $1", [checkpoint.id])).toHaveLength(0);
  });
});

describe("campaign visibility and public view", () => {
  it("shows live campaigns in campaigns_public without budget or creator cap", async () => {
    const live = await createCampaign(db, brandA, { title: "Public Live Campaign" });
    await publishCampaign(db, live.id);
    const draft = await createCampaign(db, brandA, { title: "Hidden Draft Campaign" });

    await actAs(db, IDS.creator1, "authenticated");
    const visible = await rows<Record<string, unknown>>(db, "select * from public.campaigns_public");
    const ids = visible.map((row) => row.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(draft.id);

    const row = visible.find((item) => item.id === live.id)!;
    expect(row.brand_name).toBe("Zuri Beauty");
    expect(Object.keys(row)).not.toContain("budget");
    expect(Object.keys(row)).not.toContain("creator_cap");
  });

  it("does not expose campaigns_public to anon", async () => {
    await actAs(db, null, "anon");
    await expect(db.query("select * from public.campaigns_public")).rejects.toThrow(/permission denied/);
  });

  it("keeps the base campaigns table private to brand members and admins", async () => {
    const brandBCampaign = await createCampaign(db, brandB, {
      title: "Brand B Campaign",
      actor: IDS.brandBOwner,
    });

    await actAs(db, IDS.brandBOwner, "authenticated");
    const brandBIds = (await rows<{ id: string }>(db, "select id from public.campaigns")).map((row) => row.id);
    expect(brandBIds).toEqual([brandBCampaign.id]);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const brandAIds = (await rows<{ id: string }>(db, "select id from public.campaigns")).map((row) => row.id);
    expect(brandAIds).not.toContain(brandBCampaign.id);

    await actAs(db, IDS.creator1, "authenticated");
    expect(await rows(db, "select id from public.campaigns")).toHaveLength(0);

    await actAs(db, IDS.admin, "authenticated");
    expect((await rows(db, "select id from public.campaigns")).length).toBeGreaterThan(1);
  });

  it("lets owners/managers create campaigns but not viewers or outsiders", async () => {
    await expect(
      createCampaign(db, brandA, { title: "Viewer Campaign", actor: IDS.brandAViewer }),
    ).rejects.toThrow(/row-level security/);

    const managerCampaign = await createCampaign(db, brandA, {
      title: "Manager Campaign",
      actor: IDS.brandAManager,
    });
    expect(managerCampaign.created_by).toBe(IDS.brandAManager);

    await expect(
      createCampaign(db, brandB, { title: "Cross Brand Campaign", actor: IDS.brandAOwner }),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let another brand update a campaign", async () => {
    const campaign = await createCampaign(db, brandA, { title: "Protected Campaign" });

    await actAs(db, IDS.brandBOwner, "authenticated");
    const updated = await db.query(
      "update public.campaigns set title = 'Hijacked' where id = $1 returning id",
      [campaign.id],
    );
    expect(updated.rows).toHaveLength(0);
  });
});
