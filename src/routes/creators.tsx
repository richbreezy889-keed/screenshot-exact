import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { getCreators } from "@/lib/api";
import { useApp } from "@/lib/i18n";
import { ListState, ViewsText } from "@/components/biboh/primitives";

export const Route = createFileRoute("/creators")({
  head: () => ({
    meta: [
      { title: "Creators — Biboh" },
      { name: "description", content: "Browse Tanzanian creators across food, fashion, beauty, comedy and tech." },
      { property: "og:title", content: "Creators — Biboh" },
      { property: "og:description", content: "Browse Tanzanian creators across food, fashion, beauty, comedy and tech." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreatorsPage,
});

function CreatorsPage() {
  const { t } = useApp();
  const q = useQuery({ queryKey: ["creators"], queryFn: getCreators });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold md:text-3xl">{t("creators")}</h1>
      <ListState isLoading={q.isLoading} isError={q.isError} isEmpty={!q.data?.length} emptyText={t("emptyCreators")} onRetry={() => q.refetch()}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data?.map((c) => (
            <article key={c.id} className="flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-soft">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-brand font-display font-bold text-primary-foreground">
                {c.name.split(" ").map((p) => p[0]).join("")}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-xs text-muted-foreground">{c.handle} · <span className="capitalize">{c.niche}</span></p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" aria-hidden />{c.location}</p>
                <p className="mt-2 text-sm"><ViewsText value={c.followers.tiktok + c.followers.instagram} className="font-semibold text-accent" /> {t("followers")} · <ViewsText value={c.avgViews} className="font-semibold" /> {t("avgViews")}</p>
              </div>
            </article>
          ))}
        </div>
      </ListState>
    </div>
  );
}
