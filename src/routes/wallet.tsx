import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp, type TKey } from "@/lib/i18n";
import { MOCK_TODAY } from "@/data/config";
import { walletSnapshot, type MockTopUp, type WalletEntryKind } from "@/lib/wallet";
import { formatDate } from "@/lib/format";
import { MoneyText, Panel } from "@/components/biboh/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Lock, Plus, ShieldCheck, Wallet } from "lucide-react";
const TOP_UP_MIN = 10_000;
const TOP_UP_MAX = 50_000_000;
const QUICK_AMOUNTS = [100_000, 500_000, 1_000_000, 2_000_000];

const PAYMENT_METHODS = [
  { value: "M-Pesa", label: "M-Pesa" },
  { value: "Mixx by Yas", label: "Mixx by Yas" },
  { value: "Airtel Money", label: "Airtel Money" },
  { value: "Bank transfer", label: "Bank transfer" },
];

type LedgerFilter = "all" | WalletEntryKind;

const FILTERS: { id: LedgerFilter; label: TKey }[] = [
  { id: "all", label: "all" },
  { id: "topUp", label: "topUpsFilter" },
  { id: "escrow", label: "escrowFilter" },
  { id: "payout", label: "payoutsFilter" },
  { id: "returned", label: "returnedFilter" },
];

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Biboh" },
      { name: "description", content: "Your Biboh escrow balance and payments." },
      { property: "og:title", content: "Wallet — Biboh" },
      { property: "og:description", content: "Your Biboh escrow balance and payments." },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const { t, lang } = useApp();
  const [topUps, setTopUps] = useState<MockTopUp[]>([]);
  const snapshot = useMemo(() => walletSnapshot(topUps), [topUps]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmountStr, setTopUpAmountStr] = useState("100000");
  const [topUpMethod, setTopUpMethod] = useState("M-Pesa");
  const [topUpPhone, setTopUpPhone] = useState("");
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [topUpStage, setTopUpStage] = useState<"form" | "waiting" | "success">("form");
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const amount = Number(topUpAmountStr);
  const methodNeedsPhone = topUpMethod !== "Bank transfer";
  const amountValid = Number.isFinite(amount) && amount >= TOP_UP_MIN && amount <= TOP_UP_MAX;

  const addTopUp = (value: number, method: string) => {
    setTopUps((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, date: MOCK_TODAY, amount: value, method },
    ]);
  };

  const submitTopUp = () => {
    const phoneValid =
      !methodNeedsPhone || /^(\+255|0)\d{9}$/.test(topUpPhone.replace(/[\s-]/g, ""));
    if (!amountValid) {
      setTopUpError(t("invalidAmount"));
      return;
    }
    if (methodNeedsPhone && !phoneValid) {
      setTopUpError(t("invalidPhone"));
      return;
    }
    setTopUpError(null);
    setTopUpStage("waiting");
    timerRef.current = window.setTimeout(() => {
      const value = Math.max(TOP_UP_MIN, Math.min(TOP_UP_MAX, Math.round(amount)));
      addTopUp(value, topUpMethod);
      setTopUpStage("success");
      toast.success(t("topUpSuccess"), { description: t("topUpSuccessBody") });
    }, 1500);
  };

  const closeTopUp = () => {
    setTopUpOpen(false);
    setTopUpStage("form");
    setTopUpError(null);
  };

  const entries =
    filter === "all" ? snapshot.entries : snapshot.entries.filter((entry) => entry.kind === filter);

  const kindLabel = (kind: WalletEntryKind): string => {
    switch (kind) {
      case "topUp":
        return t("topUpEntry");
      case "escrow":
        return t("escrowEntry");
      case "payout":
        return t("payoutEntry");
      case "returned":
        return t("returnedEntry");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{t("wallet")}</h1>
        <p className="mt-1 text-muted-foreground">{t("walletLedgerSub")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WalletStat
          hero
          label={t("walletAvailable")}
          help={t("walletAvailableHelp")}
          value={<MoneyText value={snapshot.available} smallPrefix />}
        />
        <WalletStat
          label={t("inEscrow")}
          help={t("balance")}
          value={<MoneyText value={snapshot.inEscrow} smallPrefix />}
          sub={
            <p className="mt-1 text-xs text-muted-foreground">
              {t("budgetReserved")}: <MoneyText value={snapshot.reserved} smallPrefix />
            </p>
          }
        />
        <div className="rounded-2xl border bg-card p-5 shadow-soft">
          <p className="text-sm text-muted-foreground">{t("walletSpent")}</p>
          <p className="mt-auto font-display text-2xl font-bold">
            <MoneyText value={snapshot.spent} smallPrefix />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("fee")}: <MoneyText value={snapshot.fee} />
          </p>
        </div>
        <WalletStat
          label={t("returned")}
          help={t("walletReturnedHelp")}
          value={<MoneyText value={snapshot.returned} smallPrefix />}
        />
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("walletLedger")}</h2>
          <Button type="button" onClick={() => setTopUpOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("topUp")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label={t("filters")}>
          {FILTERS.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={filter === item.id ? "default" : "outline"}
              size="sm"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.id === "all" ? t("all") : t(item.label)}
            </Button>
          ))}
        </div>

        {/* Desktop ledger */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t("date")}</th>
                <th className="py-2 pr-3 font-medium">{t("type")}</th>
                <th className="py-2 pr-3 font-medium">{t("campaign")}</th>
                <th className="py-2 pr-3 font-medium">
                  {t("amountIn")} / {t("amountOut")}
                </th>
                <th className="py-2 font-medium">{t("runningBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="py-2 pr-3">{formatDate(entry.date, lang)}</td>
                  <td className="py-2 pr-3">{kindLabel(entry.kind)}</td>
                  <td className="py-2 pr-3">
                    {entry.campaignId ? (
                      <Link to="/campaigns/$id" params={{ id: entry.campaignId }}>
                        {entry.campaignTitle}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 font-semibold">
                    {entry.kind === "payout" ? (
                      <span className="font-medium text-muted-foreground">
                        <MoneyText value={Math.abs(entry.amount)} />
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {t("paidFromEscrow")}
                        </span>
                      </span>
                    ) : (
                      <span
                        className={
                          entry.amount >= 0 ? "font-semibold text-success" : "font-semibold"
                        }
                      >
                        {entry.amount >= 0 ? "+" : "−"}
                        <MoneyText value={Math.abs(entry.amount)} />
                      </span>
                    )}
                    {entry.kind === "payout" && (
                      <div className="mt-1 text-xs font-normal text-muted-foreground">
                        {t("fee")}: <MoneyText value={entry.fee ?? 0} /> · {t("netToCreator")}:{" "}
                        <MoneyText value={entry.net ?? 0} />
                      </div>
                    )}
                  </td>
                  <td className="py-2 font-semibold">
                    {entry.balanceAfter >= 0 ? "+" : "−"}
                    <MoneyText value={Math.abs(entry.balanceAfter)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile ledger: card list, no horizontal scroll */}
        <ul className="divide-y md:hidden">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{kindLabel(entry.kind)}</p>
                {entry.kind === "payout" ? (
                  <p className="font-medium text-muted-foreground">
                    <MoneyText value={Math.abs(entry.amount)} />
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {t("paidFromEscrow")}
                    </span>
                  </p>
                ) : (
                  <p className={entry.amount >= 0 ? "font-semibold text-success" : "font-semibold"}>
                    {entry.amount >= 0 ? "+" : "−"}
                    <MoneyText value={Math.abs(entry.amount)} />
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(entry.date, lang)}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog open={topUpOpen} onOpenChange={(open) => !open && closeTopUp()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("topUpTitle")}</DialogTitle>
            <DialogDescription>{t("topUpDescription")}</DialogDescription>
          </DialogHeader>

          {topUpStage === "form" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="topup-amount">{t("amountTZS")}</Label>
                <Input
                  id="topup-amount"
                  type="text"
                  inputMode="numeric"
                  value={topUpAmountStr}
                  onChange={(e) => setTopUpAmountStr(e.target.value.replace(/[^0-9]/g, ""))}
                />
                <div className="flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={amount === value ? "" : "bg-transparent"}
                      onClick={() => setTopUpAmountStr(String(value))}
                    >
                      {Math.round(value / 1000)}K
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("minTopUp")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topup-method">{t("paymentMethod")}</Label>
                <Select value={topUpMethod} onValueChange={(value) => setTopUpMethod(value)}>
                  <SelectTrigger id="topup-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {methodNeedsPhone && (
                <div className="space-y-1.5">
                  <Label htmlFor="topup-phone">{t("phoneNumber")}</Label>
                  <Input
                    id="topup-phone"
                    type="tel"
                    value={topUpPhone}
                    onChange={(e) => setTopUpPhone(e.target.value)}
                    placeholder={t("phonePlaceholder")}
                  />
                </div>
              )}

              {topUpError && (
                <p className="text-sm text-destructive" role="alert">
                  {topUpError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t("selcomNote")}</p>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeTopUp}>
                  {t("cancel")}
                </Button>
                <Button type="button" onClick={submitTopUp} disabled={topUpStage !== "form"}>
                  {t("topUpConfirm")}
                </Button>
              </div>
            </div>
          )}

          {topUpStage === "waiting" && (
            <div className="space-y-3 py-6 text-center">
              <Lock className="mx-auto h-8 w-8 animate-pulse text-primary" aria-hidden />
              <p className="font-medium">{t("waitingConfirmation")}</p>
              <p className="text-sm text-muted-foreground">{t("waitingConfirmationBody")}</p>
              <Button type="button" variant="outline" onClick={closeTopUp}>
                {t("cancel")}
              </Button>
            </div>
          )}

          {topUpStage === "success" && (
            <div className="space-y-3 py-6 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-success" aria-hidden />
              <p className="font-medium">{t("topUpSuccess")}</p>
              <p className="text-sm text-muted-foreground">{t("topUpSuccessBody")}</p>
              <Button type="button" onClick={closeTopUp}>
                {t("topUp")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WalletStat({
  label,
  help,
  value,
  hero,
  sub,
}: {
  label: string;
  help: string;
  value: ReactNode;
  hero?: boolean;
  sub?: ReactNode;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-5 shadow-soft ${
        hero ? "border-transparent bg-gradient-brand text-primary-foreground" : "bg-card"
      }`}
    >
      <p className={`text-sm ${hero ? "opacity-90" : "text-muted-foreground"}`}>{label}</p>
      <p className="mt-auto pt-3 font-display text-xl font-bold">{value}</p>
      <p className={`mt-1 text-xs ${hero ? "opacity-90" : "text-muted-foreground"}`}>{help}</p>
      {sub}
    </div>
  );
}
