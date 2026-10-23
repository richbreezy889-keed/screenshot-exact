import { Link } from "@tanstack/react-router";
import { CalendarDays, Users } from "lucide-react";
import type { Campaign } from "@/data/campaigns";
import { useApp } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { MoneyText, StatusBadge } from "./primitives";

export function CampaignCard({ c }: { c: Campaign }) {
  const { t, lang } = useApp();
  return (
    <Link to="/campaigns/$id" params={{ id: c.id }} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <article className="group rounded-2xl border bg-card p-5 shadow-soft hover:-translate-y-0.5 hover:border-primary/60 ">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{c.brand} · {c.platforms.join(" + ")}</p>
          <h3 className="mt-1 font-semibold leading-snug">{c.title}</h3>
        </div>
        <StatusBadge status={c.status} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("ratePer1k")}</dt>
          <dd className="font-display font-semibold text-accent"><MoneyText value={c.ratePer1k} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("budgetRemaining")}</dt>
          <dd className="font-display font-semibold text-success"><MoneyText value={c.budget - c.spent} /></dd>
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span><span className="sr-only">{t("creatorsApproved")}: </span>{c.creatorsApproved}/{c.creatorsNeeded}</span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span><span className="sr-only">{t("deadline")}: </span>{formatDate(c.deadline, lang)}</span>
        </div>
      </dl>
    </article>
    </Link>
  );
}
