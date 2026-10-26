import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getCampaign } from "@/lib/api";
import { useApp } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { BudgetBar, ListState, MoneyText, Panel, StatusBadge } from "@/components/biboh/primitives";

type Tab = "applicants" | "content" | "results" | "payments";

export const Route = createFileRoute("/campaigns/$id")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: ["applicants", "content", "results", "payments"].includes(s.tab as string) ? (s.tab as Tab) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Campaign — Biboh" },
      { name: "description", content: "Campaign details, applicants, content and results on Biboh." },
      { property: "og:title", content: "Campaign — Biboh" },
      { property: "og:description", content: "Campaign details, applicants, content and results on Biboh." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const { t, lang } = useApp();
  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => getCampaign(id) });
  const c = q.data?.campaign;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ListState isLoading={q.isLoading} isError={q.isError} isEmpty={false} emptyText={t("notFound")} onRetry={() => q.refetch()}>
        {c && q.data && (
          <Panel className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-bold">{c.title}</h1>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("ratePer1k")}: <MoneyText value={c.ratePer1k} className="text-accent" /> · {t("deadline")}: {formatDate(c.deadline, lang)}
            </p>
            <p className="text-sm">{t("eachCanEarn")} <MoneyText value={q.data.cap} className="font-semibold text-accent" /></p>
            <BudgetBar spent={c.spent} budget={c.budget} />
            <p className="text-sm">{c.creatorsApproved} {t("approvedOf")} {c.creatorsNeeded} {t("needed")}</p>
          </Panel>
        )}
      </ListState>
    </div>
  );
}
