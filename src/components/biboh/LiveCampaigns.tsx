
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, Plus, Users } from "lucide-react"
import { useApp, dict, type TKey } from "@/lib/i18n"
import { useAuth } from "@/lib/auth"
import { getSupabase } from "@/lib/supabase"
import { getMyBrandId } from "@/lib/wallet-api"
import {
  fetchBrandCampaigns,
  type CampaignFilter,
  type CampaignListRow,
} from "@/lib/campaigns-api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ListState, MoneyText } from "@/components/biboh/primitives"

const TABS: CampaignFilter[] = ["all", "draft", "live", "completed"]

function statusLabel(t: (k: TKey) => string, status: string): string {
  const key = `campaignsLive.status.${status}`
  return key in dict ? t(key as TKey) : t("campaignsLive.status.other" as TKey)
}

function platformLabel(p: string): string {
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : ""
}

function LiveCampaignCard({ c }: { c: CampaignListRow }) {
  const { t, lang } = useApp()
  const isDraft = c.status === "draft"
  return (
    <article className="rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {(c.platforms ?? []).map(platformLabel).join(" + ")}
          </p>
          <h3 className="mt-1 font-semibold leading-snug">{c.title}</h3>
        </div>
        <span className="rounded-full border px-2.5 py-0.5 text-xs">
          {statusLabel(t, c.status)}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("ratePer1k")}</dt>
          <dd className="font-display font-semibold text-accent">
            <MoneyText value={Number(c.rate_per_1k)} />
          </dd>
        </div>
        <div>
          <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t("budget")}
            {isDraft && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold leading-none text-warning">
                {t("notFunded")}
              </span>
            )}
          </dt>
          <dd className={cn("font-display font-semibold", !isDraft && "text-success")}>
            <MoneyText value={Number(c.budget)} />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>
            <span className="sr-only">{t("campaignsLive.creatorsNeeded" as TKey)}: </span>
            {c.creators_needed}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>
            <span className="sr-only">{t("deadline")}: </span>
            {formatDate(c.deadline, lang)}
          </span>
        </div>
      </dl>
    </article>
  )
}

export function LiveCampaigns() {
  const { t } = useApp()
  const { user } = useAuth()
  const uid = user?.id ?? ""
  const [tab, setTab] = useState<CampaignFilter>("all")

  const brandQ = useQuery({
    queryKey: ["brandId", uid],
    enabled: !!uid,
    retry: 1,
    queryFn: () => getMyBrandId(getSupabase(), uid),
  })
  const brandId = brandQ.data ?? null

  const q = useQuery({
    queryKey: ["campaigns", "live", brandId, tab],
    enabled: !!brandId,
    retry: 1,
    queryFn: () => fetchBrandCampaigns(getSupabase(), brandId as string, tab),
  })

  const noBrand = brandQ.isSuccess && !brandId

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold md:text-3xl">{t("campaigns")}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("campaignsLive.createSoon" as TKey)}
          </span>
          <Button type="button" variant="hero" className="rounded-xl" disabled>
            <Plus className="h-4 w-4" />
            {t("createCampaign")}
          </Button>
        </div>
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1 sm:w-fit">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(k)}
          </button>
        ))}
      </div>
      <ListState
        isLoading={brandQ.isLoading || (!!brandId && q.isLoading)}
        isError={brandQ.isError || q.isError}
        isEmpty={noBrand || !q.data?.length}
        emptyText={t("emptyCampaigns")}
        onRetry={() => {
          void brandQ.refetch()
          void q.refetch()
        }}
        rows={4}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data?.map((c) => <LiveCampaignCard key={c.id} c={c} />)}
        </div>
      </ListState>
    </div>
  )
}