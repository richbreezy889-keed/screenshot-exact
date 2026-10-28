import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Film, MapPin, Star } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  canApproveMore,
  countApproved,
  creatorEarnings,
  feeSplit,
  getCampaign,
  getCreatorById,
} from "@/lib/api";
import { useApp } from "@/lib/i18n";
import { formatDate, formatViews } from "@/lib/format";
import {
  BudgetBar,
  ListState,
  MoneyText,
  Panel,
  StatusBadge,
  ViewsText,
} from "@/components/biboh/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type {
  Applicant,
  ApplicantStatus,
  CampaignDetailData,
  LedgerEntry,
  LedgerKind,
  Submission,
  SubmissionStatus,
} from "@/data/campaignDetail";

type Tab = "applicants" | "content" | "results" | "payments";
type CampaignData = Awaited<ReturnType<typeof getCampaign>>;

export const Route = createFileRoute("/campaigns/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab | undefined } => ({
    tab: ["applicants", "content", "results", "payments"].includes(s["tab"] as string)
      ? (s["tab"] as Tab)
      : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Campaign — Biboh" },
      {
        name: "description",
        content: "Campaign details, applicants, content and results on Biboh.",
      },
      { property: "og:title", content: "Campaign — Biboh" },
      {
        property: "og:description",
        content: "Campaign details, applicants, content and results on Biboh.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const { t, lang } = useApp();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => getCampaign(id),
    // A missing campaign is not transient — surface the empty state immediately.
    retry: (failureCount, error) =>
      (error as Error | null)?.message !== "not-found" && failureCount < 2,
    // Approve/decline/revision edits live in this cache entry; don't overwrite them on refocus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [revising, setRevising] = useState<Submission | null>(null);
  const [comment, setComment] = useState("");
  const [revisionSaved, setRevisionSaved] = useState(false);

  const tab: Tab = search.tab ?? "applicants";
  const data = q.data;
  const notFound = q.isError && (q.error as Error | null)?.message === "not-found";

  /** Patch the cached detail so counts and badges update without a refetch. */
  const updateDetail = (fn: (d: CampaignDetailData) => CampaignDetailData) => {
    qc.setQueryData<CampaignData>(["campaign", id], (old) => {
      if (!old) return old;
      const detail = fn(old.detail);
      return { ...old, detail, approved: countApproved(detail.applicants) };
    });
  };

  const setApplicantStatus = (creatorId: string, status: ApplicantStatus) =>
    updateDetail((d) => ({
      ...d,
      applicants: d.applicants.map((a) => (a.creatorId === creatorId ? { ...a, status } : a)),
    }));

  const setSubmissionStatus = (submissionId: string, status: SubmissionStatus, note?: string) =>
    updateDetail((d) => ({
      ...d,
      submissions: d.submissions.map((s) =>
        s.id === submissionId ? { ...s, status, ...(note !== undefined ? { note } : {}) } : s,
      ),
    }));

  const openRevision = (submission: Submission) => {
    setRevising(submission);
    setComment(submission.note ?? "");
    setRevisionSaved(false);
  };

  const saveRevision = () => {
    if (!revising) return;
    const note = comment.trim();
    setSubmissionStatus(revising.id, "revision", note || undefined);
    setRevising(null);
    setComment("");
    setRevisionSaved(true);
  };

  const approved = data?.approved ?? 0;
  const full = data ? !canApproveMore(approved, data.campaign.creatorsNeeded) : false;
  const pendingApplicants =
    data?.detail.applicants.filter((a) => a.status === "pending").length ?? 0;
  const awaitingContent =
    data?.detail.submissions.filter((s) => s.status === "awaiting").length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ListState
        isLoading={q.isLoading}
        isError={q.isError && !notFound}
        isEmpty={Boolean(notFound)}
        emptyText={t("notFound")}
        onRetry={() => q.refetch()}
        rows={2}
      >
        {data && (
          <>
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold">{data.campaign.title}</h1>
                <StatusBadge status={data.campaign.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("ratePer1k")}:{" "}
                <MoneyText value={data.campaign.ratePer1k} className="text-accent" /> ·{" "}
                {t("deadline")}: {formatDate(data.campaign.deadline, lang)}
              </p>
              <p className="text-sm">
                {t("eachCanEarn")}{" "}
                <MoneyText value={data.cap} className="font-semibold text-accent" />
              </p>
              <BudgetBar spent={data.campaign.spent} budget={data.campaign.budget} />
              <p className="text-sm" aria-live="polite">
                <span className="font-semibold">{approved}</span> {t("approvedOf")}{" "}
                {data.campaign.creatorsNeeded} {t("needed")}
              </p>
            </Panel>

            <Panel className="space-y-4">
              <Tabs
                value={tab}
                onValueChange={(value) =>
                  navigate({
                    to: "/campaigns/$id",
                    params: { id },
                    search: { tab: value as Tab },
                    replace: true,
                  })
                }
              >
                <TabsList
                  aria-label={t("sections")}
                  className="h-auto w-full flex-wrap justify-start gap-1"
                >
                  <TabsTrigger value="applicants">
                    {t("tabApplicants")}
                    <TabCount count={pendingApplicants} />
                  </TabsTrigger>
                  <TabsTrigger value="content">
                    {t("tabContent")}
                    <TabCount count={awaitingContent} />
                  </TabsTrigger>
                  <TabsTrigger value="results">{t("tabResults")}</TabsTrigger>
                  <TabsTrigger value="payments">{t("tabPayments")}</TabsTrigger>
                </TabsList>

                <TabsContent value="applicants" className="space-y-4 pt-4">
                  {full && (
                    <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                      {t("slotsFull")}
                    </p>
                  )}
                  <ListState
                    isLoading={false}
                    isError={false}
                    isEmpty={data.detail.applicants.length === 0}
                    emptyText={t("emptyApplicants")}
                  >
                    <ul className="grid gap-3 md:grid-cols-2">
                      {data.detail.applicants.map((a) => (
                        <li key={a.creatorId}>
                          <ApplicantCard
                            applicant={a}
                            full={full}
                            onApprove={() => setApplicantStatus(a.creatorId, "approved")}
                            onDecline={() => setApplicantStatus(a.creatorId, "declined")}
                          />
                        </li>
                      ))}
                    </ul>
                  </ListState>
                </TabsContent>

                <TabsContent value="content" className="space-y-4 pt-4">
                  <p aria-live="polite" className="sr-only">
                    {revisionSaved ? t("revisionSaved") : ""}
                  </p>
                  <ListState
                    isLoading={false}
                    isError={false}
                    isEmpty={data.detail.submissions.length === 0}
                    emptyText={t("emptyContent")}
                  >
                    <ul className="space-y-3">
                      {data.detail.submissions.map((s) => (
                        <li key={s.id}>
                          <ContentCard
                            submission={s}
                            onApprove={() => setSubmissionStatus(s.id, "approved")}
                            onRequestRevision={() => openRevision(s)}
                          />
                        </li>
                      ))}
                    </ul>
                  </ListState>
                </TabsContent>

                <TabsContent value="results" className="space-y-4 pt-4">
                  <ResultsTab data={data} />
                </TabsContent>

                <TabsContent value="payments" className="space-y-4 pt-4">
                  <PaymentsTab ledger={data.ledger} />
                </TabsContent>
              </Tabs>
            </Panel>
          </>
        )}
      </ListState>

      <Dialog
        open={revising !== null}
        onOpenChange={(open) => {
          if (!open) setRevising(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("requestRevision")}</DialogTitle>
            <DialogDescription>
              {t("requestRevision")}: {revising ? getCreatorById(revising.creatorId)?.name : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="revision-comment" className="text-sm font-medium">
              {t("revisionComment")}
            </label>
            <Textarea
              id="revision-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("commentPlaceholder")}
              rows={4}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRevising(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={saveRevision} disabled={!comment.trim()}>
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-foreground">
      {count}
    </span>
  );
}

const applicantStyles: Record<ApplicantStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  declined: "bg-muted text-muted-foreground",
};

function ApplicantBadge({ status }: { status: ApplicantStatus }) {
  const { t } = useApp();
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
        applicantStyles[status],
      )}
    >
      {t(status)}
    </span>
  );
}

function ApplicantCard({
  applicant,
  full,
  onApprove,
  onDecline,
}: {
  applicant: Applicant;
  full: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const { t } = useApp();
  const creator = getCreatorById(applicant.creatorId);
  if (!creator) return null;

  const decided = applicant.status !== "pending";
  const initials = creator.name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const followers = [
    { name: "TikTok", value: creator.followers.tiktok },
    { name: "Instagram", value: creator.followers.instagram },
  ].filter((f) => f.value > 0);

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
          <h3 className="truncate font-semibold">{creator.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {creator.handle} · <span className="capitalize">{creator.niche}</span>
          </p>
        </div>
        <ApplicantBadge status={applicant.status} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {creator.location}
        </span>
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t("rating")}: </span>
          {creator.rating.toFixed(1)}
        </span>
        <span>
          {creator.pastCampaigns} {t("pastCampaigns")}
        </span>
      </div>

      <dl className="flex flex-wrap gap-2">
        {followers.map((f) => (
          <div key={f.name} className="rounded-lg bg-background/60 px-2.5 py-1.5">
            <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {f.name}
            </dt>
            <dd className="text-sm font-semibold">
              <ViewsText value={f.value} />{" "}
              <span className="text-xs font-normal text-muted-foreground">{t("followers")}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" onClick={onApprove} disabled={decided || full}>
          {t("approve")}
        </Button>
        <Button size="sm" variant="outline" onClick={onDecline} disabled={decided}>
          {t("decline")}
        </Button>
        {full && !decided && (
          <span className="text-xs text-muted-foreground">{t("slotsFull")}</span>
        )}
      </div>
    </article>
  );
}

const submissionStyles: Record<SubmissionStatus, string> = {
  awaiting: "bg-warning/15 text-warning",
  revision: "bg-accent/15 text-accent",
  approved: "bg-success/15 text-success",
};

function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  const { t } = useApp();
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
        submissionStyles[status],
      )}
    >
      {t(status)}
    </span>
  );
}

function ContentCard({
  submission,
  onApprove,
  onRequestRevision,
}: {
  submission: Submission;
  onApprove: () => void;
  onRequestRevision: () => void;
}) {
  const { t, lang } = useApp();
  const creator = getCreatorById(submission.creatorId);
  const decided = submission.status === "approved";

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-secondary/40 p-4 sm:flex-row">
      <div
        className="grid h-20 w-full shrink-0 place-items-center rounded-xl border border-border/60 bg-background/60 sm:w-32"
        role="img"
        aria-label={t("thumbnail")}
      >
        <Film className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{creator?.name ?? submission.creatorId}</h3>
            <p className="truncate text-xs text-muted-foreground">{creator?.handle}</p>
          </div>
          <SubmissionBadge status={submission.status} />
        </div>
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {t("submitted")} {formatDate(submission.submitted, lang)}
        </p>
        {submission.note && (
          <p className="rounded-lg bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">
            {submission.note}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onApprove} disabled={decided}>
            {t("approve")}
          </Button>
          <Button size="sm" variant="outline" onClick={onRequestRevision} disabled={decided}>
            {t("requestRevision")}
          </Button>
        </div>
      </div>
    </article>
  );
}

function ResultsTab({ data }: { data: CampaignData }) {
  const { t, lang } = useApp();
  const { campaign, detail, cap } = data;

  const rows = detail.results.map((r) => ({
    ...r,
    creator: getCreatorById(r.creatorId),
    earnings: creatorEarnings(r.views, campaign.ratePer1k, cap),
  }));
  const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
  const gross = rows.reduce((sum, r) => sum + r.earnings, 0);
  const { fee, net } = feeSplit(gross);

  const chartConfig = {
    views: { label: t("views"), color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <ListState
      isLoading={false}
      isError={false}
      isEmpty={rows.length === 0}
      emptyText={t("emptyResults")}
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t("creator")}</TableHead>
                <TableHead className="text-xs">{t("post")}</TableHead>
                <TableHead className="text-right text-xs">{t("checkpointViews")}</TableHead>
                <TableHead className="text-right text-xs">{t("earningsBeforeFee")}</TableHead>
                <TableHead className="min-w-40 text-xs">{t("shareCap")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = cap > 0 ? Math.min(100, Math.round((r.earnings / cap) * 100)) : 0;
                return (
                  <TableRow key={r.creatorId}>
                    <TableCell className="font-medium">{r.creator?.name ?? r.creatorId}</TableCell>
                    <TableCell>
                      <a
                        href={r.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t("openPost")}: ${r.postUrl}`}
                        className="text-accent underline underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {safeHost(r.postUrl)}
                      </a>
                    </TableCell>
                    <TableCell className="text-right">
                      <ViewsText value={r.views} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText value={r.earnings} className="font-medium" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={pct}
                          aria-label={`${t("shareCap")}: ${pct}% ${t("ofCap")}`}
                          className="h-1.5 flex-1"
                        />
                        <span className="tnum w-9 text-right text-xs text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                      <p className="mt-1 text-[0.7rem] text-muted-foreground">
                        {t("ofCap")} <MoneyText value={cap} />
                      </p>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("total")}</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold">
                  <ViewsText value={totalViews} />
                </TableCell>
                <TableCell className="text-right font-semibold">
                  <MoneyText value={gross} />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryStat label={t("earningsBeforeFee")} value={<MoneyText value={gross} />} />
          <SummaryStat
            label={t("bibohFee")}
            value={<MoneyText value={fee} className="text-accent" />}
          />
          <SummaryStat
            label={t("netToCreator")}
            value={<MoneyText value={net} className="text-success" />}
          />
        </div>

        <div className="rounded-2xl border p-4">
          <h3 className="font-semibold">{t("viewsOverTime")}</h3>
          <ChartContainer
            config={chartConfig}
            className="mt-3 h-64 w-full"
            role="img"
            aria-label={t("viewsOverTime")}
          >
            <AreaChart
              data={detail.viewsOverTime}
              margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickFormatter={(value: string) => formatDate(value, lang)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value: number) => formatViews(value)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value: unknown) => formatDate(String(value), lang)}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke="var(--color-views)"
                fill="var(--color-views)"
                fillOpacity={0.25}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      </div>
    </ListState>
  );
}

function SummaryStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-secondary/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-bold">{value}</p>
    </div>
  );
}

const ledgerTone: Record<LedgerKind, string> = {
  funded: "text-foreground",
  paidOut: "text-accent",
  fee: "text-accent",
  returned: "text-success",
};

const ledgerSign: Record<LedgerKind, string> = {
  funded: "+",
  paidOut: "−",
  fee: "−",
  returned: "+",
};

function PaymentsTab({ ledger }: { ledger: LedgerEntry[] }) {
  const { t, lang } = useApp();
  // Newest first; entries on the same date keep reverse insertion order.
  const sorted = [...ledger].sort((a, b) =>
    a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date),
  );

  return (
    <ListState
      isLoading={false}
      isError={false}
      isEmpty={sorted.length === 0}
      emptyText={t("emptyPayments")}
    >
      <div className="space-y-3">
        <h3 className="font-semibold">{t("ledger")}</h3>
        <div className="overflow-hidden rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t("date")}</TableHead>
                <TableHead className="text-xs">{t("type")}</TableHead>
                <TableHead className="text-right text-xs">{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.date, lang)}
                  </TableCell>
                  <TableCell className="font-medium">{t(entry.kind)}</TableCell>
                  <TableCell
                    className={cn("text-right font-semibold tnum", ledgerTone[entry.kind])}
                  >
                    <span aria-hidden>{ledgerSign[entry.kind]}</span>
                    <MoneyText value={entry.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </ListState>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
