import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  CheckCircle2,
  Eye,
  Megaphone,
  Plus,
  ShieldCheck,
  UserPlus,
  Wallet,
  Gauge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { attentionTab } from "@/data/dashboard";
import { getActiveCampaigns, getAttentionItems, getDailySeries, getStats } from "@/lib/api";
import { useApp } from "@/lib/i18n";
import { attentionLabelKey } from "@/lib/plural";
import { formatDate, formatTZS, formatViews } from "@/lib/format";
import {
  BudgetBar,
  ListState,
  MoneyText,
  Panel,
  StatCard,
  StatusBadge,
  ViewsText,
} from "@/components/biboh/primitives";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Biboh" },
      {
        name: "description",
        content: "Track spend, verified views and active creator campaigns on Biboh.",
      },
      { property: "og:title", content: "Dashboard — Biboh" },
      {
        property: "og:description",
        content: "Track spend, verified views and active creator campaigns on Biboh.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { t, lang } = useApp();
  const stats = useQuery({ queryKey: ["stats"], queryFn: getStats });
  const series = useQuery({ queryKey: ["series"], queryFn: getDailySeries });
  const attention = useQuery({ queryKey: ["attention"], queryFn: getAttentionItems });
  const active = useQuery({ queryKey: ["campaigns", "live"], queryFn: getActiveCampaigns });

  const icons = {
    approveVideo: CheckCircle2,
    verifyViews: ShieldCheck,
    applicants: UserPlus,
  } as const;
  const chartConfig = {
    views: { label: t("views"), color: "var(--chart-1)" },
    spend: { label: t("spend"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{t("greeting")} 👋</h1>
          <p className="mt-1 text-muted-foreground">{t("greetingSub")}</p>
        </div>
        <Button asChild variant="hero" size="lg" className="rounded-xl">
          <Link to="/campaigns/new">
            <Plus className="h-4 w-4" />
            {t("createCampaign")}
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 md:gap-4">
        {stats.isLoading || !stats.data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl bg-secondary" />
          ))
        ) : (
          <>
            <StatCard
              hero
              label={t("totalSpend")}
              value={<MoneyText smallPrefix value={stats.data.spend} />}
              icon={<Wallet className="h-4 w-4" />}
            />
            <StatCard
              label={t("verifiedViews")}
              value={<ViewsText value={stats.data.views} />}
              icon={<Eye className="h-4 w-4" />}
            />
            <StatCard
              label={t("activeCampaigns")}
              value={stats.data.active}
              icon={<Megaphone className="h-4 w-4" />}
            />
            <StatCard
              label={t("avgCpm")}
              value={<MoneyText smallPrefix value={stats.data.avgCpm} />}
              icon={<Gauge className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <h2 className="font-semibold">{t("last30")}</h2>
          <div className="mt-4">
            {series.isLoading ? (
              <Skeleton className="h-72 rounded-xl bg-secondary" />
            ) : (
              <ChartContainer
                config={chartConfig}
                className="h-72 w-full"
                role="group"
                aria-label={t("last30")}
              >
                <ComposedChart
                  data={series.data ?? []}
                  margin={{ left: 0, right: 4, top: 8 }}
                  accessibilityLayer
                >
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(8)}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="v"
                    tickFormatter={formatViews}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <YAxis
                    yAxisId="s"
                    orientation="right"
                    tickFormatter={(value: number) => `TZS ${formatViews(value)}`}
                    stroke="var(--chart-2)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={62}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value: unknown) => formatDate(String(value), lang)}
                        formatter={(value, _name, item) => {
                          const numeric = Number(value);
                          return item?.dataKey === "spend"
                            ? formatTZS(numeric)
                            : formatViews(numeric);
                        }}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    yAxisId="v"
                    type="monotone"
                    dataKey="views"
                    name={t("views")}
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#gv)"
                  />
                  <Line
                    yAxisId="s"
                    type="monotone"
                    dataKey="spend"
                    name={t("spend")}
                    stroke="var(--chart-2)"
                    strokeWidth={1.75}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </ComposedChart>
              </ChartContainer>
            )}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-semibold">{t("attention")}</h2>
          <div className="mt-4">
            <ListState
              isLoading={attention.isLoading}
              isError={attention.isError}
              isEmpty={!attention.data?.length}
              emptyText={t("emptyAttention")}
              onRetry={() => attention.refetch()}
            >
              <ul className="space-y-2">
                {attention.data?.map((a) => {
                  const Icon = icons[a.kind];
                  return (
                    <li key={a.id}>
                      <Link
                        to="/campaigns/$id"
                        params={{ id: a.campaignId }}
                        search={{ tab: attentionTab[a.kind] }}
                        className="flex w-full items-center gap-3 rounded-xl bg-secondary p-3 text-left hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="rounded-lg bg-accent/15 p-2 text-accent">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            <span className="tnum">
                              {a.kind === "verifyViews" ? formatViews(a.count) : a.count}
                            </span>{" "}
                            {t(attentionLabelKey(a.kind, a.count))}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {a.campaign}
                            {a.creator && ` · ${a.creator}`}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-primary">{t("review")}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </ListState>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("activeCampaigns")}</h2>
          <Link to="/campaigns" className="text-sm font-medium text-primary hover:underline">
            {t("all")} →
          </Link>
        </div>
        <div className="mt-4">
          <ListState
            isLoading={active.isLoading}
            isError={active.isError}
            isEmpty={!active.data?.length}
            emptyText={t("emptyCampaigns")}
            onRetry={() => active.refetch()}
          >
            <ul className="divide-y">
              {active.data?.map((c) => (
                <li
                  key={c.id}
                  className="grid gap-3 py-4 md:grid-cols-[1fr_1.4fr] md:items-center md:gap-8"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Link
                        to="/campaigns/$id"
                        params={{ id: c.id }}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {c.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.brand} · <ViewsText value={c.views} /> {t("views").toLowerCase()}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <BudgetBar spent={c.spent} budget={c.budget} />
                </li>
              ))}
            </ul>
          </ListState>
        </div>
      </Panel>
    </div>
  );
}
