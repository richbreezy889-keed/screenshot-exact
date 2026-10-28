import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS, formatViews } from "@/lib/format";
import { useApp } from "@/lib/i18n";
import type { CampaignStatus } from "@/data/campaigns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function MoneyText({
  value,
  className,
  smallPrefix,
}: {
  value: number;
  className?: string;
  smallPrefix?: boolean;
}) {
  if (smallPrefix)
    return (
      <span className={cn("tnum whitespace-nowrap", className)}>
        <span className="mr-1 align-baseline text-[0.5em] font-semibold opacity-80">TZS</span>
        {Math.round(value).toLocaleString("en-US")}
      </span>
    );
  return <span className={cn("tnum", className)}>{formatTZS(value)}</span>;
}

export function ViewsText({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tnum", className)}>{formatViews(value)}</span>;
}

const statusStyles: Record<CampaignStatus, string> = {
  live: "bg-success/15 text-success",
  draft: "bg-warning/15 text-warning",
  completed: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const { t } = useApp();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        statusStyles[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {t(status)}
    </span>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)}>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  icon,
  hero,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 shadow-soft",
        hero ? "border-transparent bg-gradient-brand text-primary-foreground" : "bg-card",
      )}
    >
      <div className="flex items-center justify-between">
        <p className={cn("text-sm", hero ? "opacity-90" : "text-muted-foreground")}>{label}</p>
        <span
          className={cn("rounded-xl p-2", hero ? "bg-background/20" : "bg-secondary text-accent")}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 truncate whitespace-nowrap font-display text-xl font-bold tnum sm:text-2xl xl:text-3xl">
        {value}
      </p>
    </div>
  );
}

export function BudgetBar({
  spent,
  budget,
  completed,
}: {
  spent: number;
  budget: number;
  completed?: boolean;
}) {
  const { t } = useApp();
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>
          <MoneyText value={spent} /> {t("budgetUsed")}
        </span>
        <span>
          <MoneyText value={budget - spent} className="text-success" />{" "}
          {completed ? t("returned") : t("budgetLeft")}
        </span>
      </div>
    </div>
  );
}

export function ListState({
  isLoading,
  isError,
  isEmpty,
  emptyText,
  onRetry,
  rows = 3,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyText: string;
  onRetry?: () => void;
  rows?: number;
  children: ReactNode;
}) {
  const { t } = useApp();
  if (isLoading)
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl bg-secondary" />
        ))}
      </div>
    );
  if (isError)
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/40 p-8 text-center"
        role="alert"
      >
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="text-sm">{t("error")}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </div>
    );
  if (isEmpty)
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
        <Inbox className="h-6 w-6" />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  return <>{children}</>;
}
