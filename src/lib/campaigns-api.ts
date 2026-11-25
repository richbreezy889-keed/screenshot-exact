import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

type Client = SupabaseClient<Database>
type CampaignRowFull = Database["public"]["Tables"]["campaigns"]["Row"]

export type CampaignFilter = "all" | "draft" | "live" | "completed"

export type CampaignListRow = Pick<
  CampaignRowFull,
  | "id"
  | "title"
  | "status"
  | "niche"
  | "platforms"
  | "budget"
  | "rate_per_1k"
  | "creators_needed"
  | "deadline"
  | "published_at"
  | "created_at"
>

const COLUMNS =
  "id,title,status,niche,platforms,budget,rate_per_1k,creators_needed,deadline,published_at,created_at"

/** The brand's campaigns, newest first. Money figures are stored values, not computed. */
export async function fetchBrandCampaigns(
  sb: Client,
  brandId: string,
  filter: CampaignFilter = "all",
): Promise<CampaignListRow[]> {
  let q = sb
    .from("campaigns")
    .select(COLUMNS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(200)
  if (filter !== "all") q = q.eq("status", filter)
  const { data, error } = await q
  if (error) throw new Error("campaigns_load_failed")
  return (data ?? []) as CampaignListRow[]
}