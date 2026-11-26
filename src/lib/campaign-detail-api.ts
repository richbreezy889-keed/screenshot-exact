import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

type Client = SupabaseClient<Database>
type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"]
type CreatorRow = Pick<
  Database["public"]["Tables"]["creators"]["Row"],
  "id" | "display_name" | "handle" | "niche" | "location" | "rating" | "past_campaigns"
>

const FAIL = "campaign_detail_load_failed"

export type CampaignHeader = Pick<
  CampaignRow,
  | "id"
  | "title"
  | "status"
  | "rate_per_1k"
  | "budget"
  | "creator_cap"
  | "creators_needed"
  | "deadline"
  | "platforms"
  | "niche"
>

export interface FollowerStat {
  platform: string
  followers: number
  avgViews: number
}

export interface ApplicantView {
  applicationId: string
  creatorId: string
  status: string
  pitch: string | null
  appliedAt: string
  name: string
  handle: string
  niche: string | null
  location: string | null
  rating: number
  pastCampaigns: number
  followers: FollowerStat[]
}

export interface SubmissionView {
  id: string
  creatorId: string
  creatorName: string
  creatorHandle: string
  platform: string
  videoUrl: string
  postedAt: string
  status: string
  note: string | null
}

/** Only http(s) links may be opened. Video links are typed in by creators. */
export function safeHttpUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null
  } catch {
    return null
  }
}

export async function fetchCampaignHeader(
  sb: Client,
  campaignId: string,
): Promise<CampaignHeader | null> {
  const { data, error } = await sb
    .from("campaigns")
    .select(
      "id,title,status,rate_per_1k,budget,creator_cap,creators_needed,deadline,platforms,niche",
    )
    .eq("id", campaignId)
    .maybeSingle()
  if (error) throw new Error(FAIL)
  return (data ?? null) as CampaignHeader | null
}

async function fetchCreators(sb: Client, ids: string[]): Promise<Map<string, CreatorRow>> {
  const map = new Map<string, CreatorRow>()
  if (ids.length === 0) return map
  const { data, error } = await sb
    .from("creators")
    .select("id,display_name,handle,niche,location,rating,past_campaigns")
    .in("id", ids)
  if (error) throw new Error(FAIL)
  for (const c of (data ?? []) as CreatorRow[]) map.set(c.id, c)
  return map
}

export async function fetchApplicants(
  sb: Client,
  campaignId: string,
): Promise<ApplicantView[]> {
  const { data, error } = await sb
    .from("applications")
    .select("id,creator_id,status,pitch,created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(200)
  if (error) throw new Error(FAIL)
  const apps = data ?? []
  if (apps.length === 0) return []

  const ids = [...new Set(apps.map((a) => a.creator_id))]
  const creators = await fetchCreators(sb, ids)

  const { data: socials, error: socialError } = await sb
    .from("social_accounts")
    .select("creator_id,platform,followers,avg_views")
    .in("creator_id", ids)
  if (socialError) throw new Error(FAIL)

  const byCreator = new Map<string, FollowerStat[]>()
  for (const s of socials ?? []) {
    const list = byCreator.get(s.creator_id) ?? []
    list.push({
      platform: s.platform,
      followers: Number(s.followers),
      avgViews: Number(s.avg_views),
    })
    byCreator.set(s.creator_id, list)
  }

  return apps.map((a) => {
    const c = creators.get(a.creator_id)
    return {
      applicationId: a.id,
      creatorId: a.creator_id,
      status: a.status,
      pitch: a.pitch ?? null,
      appliedAt: a.created_at,
      name: c?.display_name ?? "",
      handle: c?.handle ?? "",
      niche: c?.niche ?? null,
      location: c?.location ?? null,
      rating: Number(c?.rating ?? 0),
      pastCampaigns: Number(c?.past_campaigns ?? 0),
      followers: byCreator.get(a.creator_id) ?? [],
    }
  })
}

export async function fetchSubmissions(
  sb: Client,
  campaignId: string,
): Promise<SubmissionView[]> {
  const { data, error } = await sb
    .from("submissions")
    .select("id,creator_id,platform,video_url,posted_at,status,note,created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error) throw new Error(FAIL)
  const rows = data ?? []
  if (rows.length === 0) return []

  const creators = await fetchCreators(sb, [...new Set(rows.map((r) => r.creator_id))])
  return rows.map((r) => {
    const c = creators.get(r.creator_id)
    return {
      id: r.id,
      creatorId: r.creator_id,
      creatorName: c?.display_name ?? "",
      creatorHandle: c?.handle ?? "",
      platform: r.platform,
      videoUrl: r.video_url,
      postedAt: r.posted_at,
      status: r.status,
      note: r.note ?? null,
    }
  })
}