import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCampaigns } from "@/lib/api";
import { useApp } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CampaignCard } from "@/components/biboh/CampaignCard";
import { ListState } from "@/components/biboh/primitives";

export const Route = createFileRoute("/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campaigns — Biboh" },
      { name: "description", content: "All your pay-per-view creator campaigns in one place." },
      { property: "og:title", content: "Campaigns — Biboh" },
      { property: "og:description", content: "All your pay-per-view creator campaigns in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignsPage,
});

const tabs = ["all", "draft", "live", "completed"] as const;

function CampaignsPage() {
  const { t } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>("all");
  const q = useQuery({ queryKey: ["campaigns", tab], queryFn: () => getCampaigns(tab) });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold md:text-3xl">{t("campaigns")}</h1>
        <Button asChild variant="hero" className="rounded-xl">
          <Link to="/campaigns/new"><Plus className="h-4 w-4" />{t("createCampaign")}</Link>
        </Button>
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1 sm:w-fit">
        {tabs.map((k) => (
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
      <ListState isLoading={q.isLoading} isError={q.isError} isEmpty={!q.data?.length} emptyText={t("emptyCampaigns")} onRetry={() => q.refetch()} rows={4}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data?.map((c) => <CampaignCard key={c.id} c={c} />)}
        </div>
      </ListState>
    </div>
  );
}
