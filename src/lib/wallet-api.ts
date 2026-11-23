import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

type Client = SupabaseClient<Database>
type Fns = Database["public"]["Functions"]

// The generated types mark these columns as non-null, but the database
// returns null for them (a deposit has no campaign; a pending deposit has
// no confirmation time). Override so the screens must handle null.
export type StatementRow = Omit<
  Fns["brand_wallet_statement"]["Returns"][number],
  "campaign_id" | "reference"
> & { campaign_id: string | null; reference: string | null }

export type DepositRow = Omit<
  Fns["list_brand_deposits"]["Returns"][number],
  "confirmed_at"
> & { confirmed_at: string | null }
export type WalletFailureReason = "notAllowed" | "network" | "unknown"

/** A wallet failure with a reason code. Screens translate the reason. */
export class WalletFailure extends Error {
  reason: WalletFailureReason
  constructor(reason: WalletFailureReason) {
    super(reason)
    this.name = "WalletFailure"
    this.reason = reason
  }
}

function toFailure(error: unknown): WalletFailure {
  const e = error as { code?: string; message?: string; name?: string } | null
  const msg = (e?.message ?? "").toLowerCase()
  if (e?.code === "42501" || msg.includes("not allowed")) {
    return new WalletFailure("notAllowed")
  }
  if (
    e?.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return new WalletFailure("network")
  }
  return new WalletFailure("unknown")
}

/** The brand the signed-in user belongs to, or null if they have none yet. */
export async function getMyBrandId(sb: Client, uid: string): Promise<string | null> {
  const { data, error } = await sb
    .from("brand_members")
    .select("brand_id")
    .eq("user_id", uid)
    .limit(1)
  if (error) throw toFailure(error)
  return data?.[0]?.brand_id ?? null
}

/** Creates the user's brand and returns its id. */
export async function createBrandWith(sb: Client, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new WalletFailure("unknown")
  const { data, error } = await sb.rpc("create_brand", { brand_name: trimmed })
  if (error) throw toFailure(error)
  if (!data?.id) throw new WalletFailure("unknown")
  return data.id
}
/** Available balance in whole TZS, straight from the ledger. */
export async function fetchWalletSummary(sb: Client, brandId: string): Promise<number> {
  const { data, error } = await sb.rpc("brand_wallet_summary", { p_brand_id: brandId })
  if (error) throw toFailure(error)
  return Number(data ?? 0)
}

export async function fetchWalletStatement(
  sb: Client,
  brandId: string,
  limit = 100,
): Promise<StatementRow[]> {
  const { data, error } = await sb.rpc("brand_wallet_statement", {
    p_brand_id: brandId,
    p_limit: limit,
  })
  if (error) throw toFailure(error)
  return data ?? []
}

export async function fetchBrandDeposits(
  sb: Client,
  brandId: string,
  limit = 50,
): Promise<DepositRow[]> {
  const { data, error } = await sb.rpc("list_brand_deposits", {
    p_brand_id: brandId,
    p_limit: limit,
  })
  if (error) throw toFailure(error)
  return data ?? []
}