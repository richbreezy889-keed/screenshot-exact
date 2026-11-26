import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, ExternalLink, Film, MapPin, Star } from "lucide-react"
import { useApp, dict, type TKey } from "@/lib/i18n"
import { getSupabase } from "@/lib/supabase"
import {
  fetchApplicants,
  fetchCampaignHeader,
  fetchSubmissions,
  safeHttpUrl,
  type ApplicantView,
  type SubmissionView,
} from "@/lib/campaign-detail-api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ListState, MoneyText, Panel, ViewsText } from "@/components/biboh/primitives"

type Tab = "applicants" | "content" | "results" | "payments"

const TABS: { id: Tab; label: TKey }[] = [
  { id: "applicants", label: "tabApplicants" },
  { id: "content", label: "tabContent" },
  { id: "results", label: "tabResults" },
  { id: "payments", label: "tabPayments" },
]

const PLAIN_STATUSES = ["applied", "approved", "rejected", "withdrawn", "awaiting", "revision"]

/** Known codes are translated; anything else shows "Other", never the raw code. */
function plainStatus(t: (k: TKey) => string, status: string): string {
  return PLAIN_STATUSES.includes(status)
    ? t(status as TKey)
    : t("detailLive.statusOther" as TKey)
}

function campaignStatus(t: (k: TKey) => string, status: string): string {
  const key = `campaignsLive.status.${status}`
  return key in dict ? t(key as TKey) : t("campaignsLive.status.other" as TKey)
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""
}

function Badge({ children }: { children: string }) {
  return <span className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs">{children}</span>
}

function ApplicantCard({ a }: { a: ApplicantView }) {
  const { t } = useApp()
  const display = a.name || a.handle || "-"
  const initials = display
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border bg-secondary/40 p-4">
      <div className="flex items-start gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-brand text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{display}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {a.handle}
            {a.niche ? ` · ${a.niche}` : ""}
          </p>
        </div>
        <Badge>{plainStatus(t, a.status)}</Badge>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {a.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {a.location}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t("rating")}: </span>
          {a.rating.toFixed(1)}
        </span>
        <span>
          {a.pastCampaigns} {t("pastCampaigns")}
        </span>
      </div>

      {a.followers.length > 0 && (
        <dl className="flex flex-wrap gap-2">
          {a.followers.map((f) => (
            <div key={f.platform} className="rounded-lg bg-background/60 px-2.5 py-1.5">
              <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {cap(f.platform)}
              </dt>
              <dd className="text-sm font-semibold">
                <ViewsText value={f.followers} />{" "}
                <span className="text-xs font-normal text-muted-foreground">{t("followers")}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-sm text-muted-foreground">
        {a.pitch ? a.pitch : t("detailLive.noPitch" as TKey)}
      </p>
    </article>
  )
}

function SubmissionCard({ s }: { s: SubmissionView }) {
  const { t, lang } = useApp()
  const href = safeHttpUrl(s.videoUrl)
  const display = s.creatorName || s.creatorHandle || "-"

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-secondary/40 p-4 sm:flex-row">
      <div
        className="grid h-20 w-full shrink-0 place-items-center rounded-xl border border-border/60 bg-background/60 sm:w-32"
        aria-hidden
      >
        <Film className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{display}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {s.creatorHandle} · {cap(s.platform)}
            </p>
          </div>
          <Badge>{plainStatus(t, s.status)}</Badge>
        </div>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {t("submitted")} {formatDate(s.postedAt, lang)}
        </p>
        {s.note && (
          <p className="rounded-lg bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">
            {s.note}
          </p>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-4"
          >
            {t("detailLive.openVideo" as TKey)}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </article>
  )
}

export function LiveCampaignDetail({ id }: { id: string }) {
  const { t, lang } = useApp()
  const [tab, setTab] = useState<Tab>("applicants")

  const headerQ = useQuery({
    queryKey: ["campaignDetail", "header", id],
    retry: 1,
    queryFn: () => fetchCampaignHeader(getSupabase(), id),
  })
  const header = headerQ.data ?? null
  const notFound = headerQ.isSuccess && !header

  const applicantsQ = useQuery({
    queryKey: ["campaignDetail", "applicants", id],
    enabled: !!header,
    retry: 1,
    queryFn: () => fetchApplicants(getSupabase(), id),
  })
  const submissionsQ = useQuery({
    queryKey: ["campaignDetail", "submissions", id],
    enabled: !!header,
    retry: 1,
    queryFn: () => fetchSubmissions(getSupabase(), id),
  })

  const approved = (applicantsQ.data ?? []).filter((a) => a.status === "approved").length

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ListState
        isLoading={headerQ.isLoading}
        isError={headerQ.isError}
        isEmpty={notFound}
        emptyText={t("notFound")}
        onRetry={() => void headerQ.refetch()}
        rows={2}
      >
        {header && (
          <>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold">{header.title}</h1>
                <Badge>{campaignStatus(t, header.status)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("ratePer1k")}:{" "}
                <MoneyText value={Number(header.rate_per_1k)} className="text-accent" /> ·{" "}
                {t("deadline")}: {formatDate(header.deadline, lang)}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("budget")}: <MoneyText value={Number(header.budget)} />
                {header.creator_cap != null && (
                  <>
                    {" · "}
                    {t("eachCanEarn")}{" "}
                    <MoneyText
                      value={Number(header.creator_cap)}
                      className="font-semibold text-accent"
                    />
                  </>
                )}
              </p>
              <p className="text-sm" aria-live="polite">
                <span className="font-semibold">{approved}</span> {t("approvedOf")}{" "}
                {header.creators_needed} {t("needed")}
              </p>
            </Panel>

            <Panel className="space-y-4">
              <div
                role="tablist"
                aria-label={t("sections")}
                className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1 sm:w-fit"
              >
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "shrink-0 rounded-xl px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      tab === item.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>

              {tab === "applicants" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    {t("detailLive.actionsSoon" as TKey)}
                  </p>
                  <ListState
                    isLoading={applicantsQ.isLoading}
                    isError={applicantsQ.isError}
                    isEmpty={!applicantsQ.data?.length}
                    emptyText={t("emptyApplicants")}
                    onRetry={() => void applicantsQ.refetch()}
                    rows={2}
                  >
                    <ul className="grid gap-3 md:grid-cols-2">
                      {applicantsQ.data?.map((a) => (
                        <li key={a.applicationId}>
                          <ApplicantCard a={a} />
                        </li>
                      ))}
                    </ul>
                  </ListState>
                </div>
              )}

              {tab === "content" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    {t("detailLive.actionsSoon" as TKey)}
                  </p>
                  <ListState
                    isLoading={submissionsQ.isLoading}
                    isError={submissionsQ.isError}
                    isEmpty={!submissionsQ.data?.length}
                    emptyText={t("emptyContent")}
                    onRetry={() => void submissionsQ.refetch()}
                    rows={2}
                  >
                    <ul className="space-y-3">
                      {submissionsQ.data?.map((s) => (
                        <li key={s.id}>
                          <SubmissionCard s={s} />
                        </li>
                      ))}
                    </ul>
                  </ListState>
                </div>
              )}

              {(tab === "results" || tab === "payments") && (
                <p className="text-sm text-muted-foreground">
                  {t("detailLive.resultsPaymentsSoon" as TKey)}
                </p>
              )}
            </Panel>
          </>
        )}
      </ListState>
    </div>
  )
}