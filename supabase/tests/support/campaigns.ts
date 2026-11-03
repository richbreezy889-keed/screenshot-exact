import { actAs, asPostgres, IDS, rows, type Db } from "./db";

export const EXTRA_CREATOR_IDS = [
  "00000000-0000-4000-8000-000000000010",
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013",
  "00000000-0000-4000-8000-000000000014",
  "00000000-0000-4000-8000-000000000015",
  "00000000-0000-4000-8000-000000000016",
] as const;

export type CampaignRow = {
  id: string;
  brand_id: string;
  created_by: string;
  title: string;
  status: string;
  platforms: string[];
  rate_per_1k: number;
  budget: number;
  creators_needed: number;
  videos_per_creator: number;
  creator_cap: number;
  deadline: string;
};

export type CampaignInput = {
  title?: string;
  status?: string;
  platforms?: string;
  rate?: number;
  budget?: number;
  creators?: number;
  maxVideos?: number;
  deadline?: string;
  actor?: string;
};

export async function seedExtraCreators(db: Db): Promise<string[]> {
  await asPostgres(db);

  for (let index = 0; index < EXTRA_CREATOR_IDS.length; index += 1) {
    const id = EXTRA_CREATOR_IDS[index]!;
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
      [id, `extra-creator-${index}@biboh.test`, JSON.stringify({ role: "creator" })],
    );
    await db.query(
      "insert into public.creators (id, display_name, handle) values ($1, $2, $3)",
      [id, `Extra Creator ${index + 1}`, `@extra${index + 1}`],
    );
  }

  return [...EXTRA_CREATOR_IDS];
}

export async function createCampaign(
  db: Db,
  brandId: string,
  input: CampaignInput = {},
): Promise<CampaignRow> {
  const actor = input.actor ?? IDS.brandAOwner;
  await actAs(db, actor, "authenticated");

  const [campaign] = await rows<CampaignRow>(
    db,
    `insert into public.campaigns
       (brand_id, title, status, platforms, rate_per_1k, budget,
        creators_needed, videos_per_creator, deadline)
     values ($1, $2, $3::public.campaign_status, $4::public.social_platform[],
        $5, $6, $7, $8, $9)
     returning *`,
    [
      brandId,
      input.title ?? "Test Campaign",
      input.status ?? "draft",
      input.platforms ?? "{tiktok}",
      input.rate ?? 4000,
      input.budget ?? 2_000_000,
      input.creators ?? 5,
      input.maxVideos ?? 1,
      input.deadline ?? "2026-12-31",
    ],
  );

  return campaign!;
}

/**
 * Publishing is a platform action (a server function in step 4+), so the test
 * helper acts as the service role. Brands cannot change status directly.
 */
export async function publishCampaign(
  db: Db,
  campaignId: string,
  _actor = IDS.brandAOwner,
): Promise<CampaignRow> {
  await actAs(db, null, "service_role");
  const [campaign] = await rows<CampaignRow>(
    db,
    "update public.campaigns set status = 'live', published_at = now() where id = $1 returning *",
    [campaignId],
  );
  return campaign!;
}

export async function applyToCampaign(
  db: Db,
  campaignId: string,
  creatorId: string,
): Promise<{ id: string; campaign_id: string; creator_id: string; status: string }> {
  await actAs(db, creatorId, "authenticated");
  const [application] = await rows<{
    id: string;
    campaign_id: string;
    creator_id: string;
    status: string;
  }>(
    db,
    `insert into public.applications (campaign_id, creator_id)
     values ($1, $2)
     returning id, campaign_id, creator_id, status`,
    [campaignId, creatorId],
  );
  return application!;
}

export async function approveApplication(
  db: Db,
  applicationId: string,
  actor = IDS.brandAOwner,
): Promise<{ id: string; status: string; reviewed_by: string | null }> {
  await actAs(db, actor, "authenticated");
  const [application] = await rows<{ id: string; status: string; reviewed_by: string | null }>(
    db,
    "update public.applications set status = 'approved' where id = $1 returning id, status, reviewed_by",
    [applicationId],
  );
  return application!;
}

export type SubmissionRow = {
  id: string;
  application_id: string;
  campaign_id: string;
  creator_id: string;
  status: string;
};

export async function submitVideo(
  db: Db,
  input: {
    applicationId: string;
    campaignId: string;
    creatorId: string;
    url?: string;
    postedAt?: string;
  },
): Promise<SubmissionRow> {
  const creatorId = input.creatorId;
  // An explicit historical posted_at is inserted by the platform (service
  // role); the creator path always uses the real clock, as the app will.
  if (input.postedAt) {
    await actAs(db, null, "service_role");
  } else {
    await actAs(db, creatorId, "authenticated");
  }

  const [submission] = await rows<SubmissionRow>(
    db,
    `insert into public.submissions
       (application_id, campaign_id, creator_id, platform, video_url, posted_at)
     values ($1, $2, $3, 'tiktok', $4, $5)
     returning id, application_id, campaign_id, creator_id, status`,
    [
      input.applicationId,
      input.campaignId,
      creatorId,
      input.url ?? `https://example.com/${crypto.randomUUID()}`,
      input.postedAt ?? new Date().toISOString(),
    ],
  );

  return submission!;
}

export async function checkpointFor(
  db: Db,
  submissionId: string,
): Promise<{ id: string; checkpoint_at: string; views: number; status: string } | null> {
  await asPostgres(db);
  return (
    (
      await rows<{ id: string; checkpoint_at: string; views: number; status: string }>(
        db,
        "select id, checkpoint_at, views, status from public.view_checkpoints where submission_id = $1",
        [submissionId],
      )
    )[0] ?? null
  );
}
