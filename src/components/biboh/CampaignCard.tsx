import { Link } from "@tanstack/react-router";
import { CalendarDays, Users } from "lucide-react";
import type { Campaign } from "@/data/campaigns";
import { useApp } from "@/lib/i18n";
import { formatDate, formatViews } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoneyText, StatusBadge } from "./primitives";

export function CampaignCard({ c }: { c: Campaign }) {
  const { t, lang } = useApp();
  const isDraft = c.status === "draft";
  const usedPct = c.budget ? Math.min(100, (c.spent / c.budget) * 100) : 0;

  return (
    <Link
      to="/campaigns/$id"
      params={{ id: c.id }}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <article className="group rounded-2xl border bg-card p-5 shadow-soft hover:-translate-y-0.5 hover:border-primary/60 ">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {c.brand} · {c.platforms.join(" + ")}
            </p>
            <h3 className="mt-1 font-semibold leading-snug">{c.title}</h3>
          </div>
          <StatusBadge status={c.status} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t("ratePer1k")}</dt>
            <dd className="font-display font-semibold text-accent">
              <MoneyText value={c.ratePer1k} />
            </dd>
          </div>
          <div>
            <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {isDraft ? (
                <>
                  {t("budget")}
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold leading-none text-warning">
                    {t("notFunded")}
                  </span>
                </>
              ) : c.status === "completed" ? (
                t("returned")
              ) : (
                t("budgetRemaining")
              )}
            </dt>
            <dd
              className={cn(
                "font-display font-semibold",
                isDraft ? "text-foreground" : "text-success",
              )}
            >
              <MoneyText value={isDraft ? c.budget : c.budget - c.spent} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>
              <span className="sr-only">{t("creatorsApproved")}: </span>
              {c.creatorsApproved}/{c.creatorsNeeded}
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
        {!isDraft && (
          <div className="mt-4 space-y-1.5">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label={`${t("budget")} ${t("budgetUsed")}`}
              aria-valuenow={Math.round(usedPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-gradient-brand"
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {Math.round(usedPct)}% {t("budgetUsed")}
              </span>
              <span className="tnum">
                {formatViews(c.views)} {t("verifiedViews").toLowerCase()}
              </span>
            </div>
          </div>
        )}
      </article>
    </Link>
  );
}
