import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, CheckCircle2, Lock, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { creatorCap, estimateViews, fundCampaign } from "@/lib/api";
import { MIN_RATE_PER_1K } from "@/data/config";
import { useApp, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MoneyText, Panel, ViewsText } from "@/components/biboh/primitives";
import { formatDate, formatTZS } from "@/lib/format";

function NumInput({
  value,
  onChange,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  "aria-describedby"?: string;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      value={value ? value.toLocaleString("en-US") : ""}
      onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
    />
  );
}

const steps: TKey[] = ["stepBrief", "stepBudget", "stepReq", "stepReview"];
const niches = ["food", "fashion", "beauty", "comedy", "tech"];
const locations = ["Anywhere in Tanzania", "Dar es Salaam", "Arusha", "Mwanza", "Dodoma"];
const lengths = ["15–30s", "30–60s", "60–90s"];
const payments = ["M-Pesa", "Mixx by Yas", "Airtel Money", "Card"];

const field =
  "mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string | undefined;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "text-muted-foreground hover:border-primary/60",
      )}
    >
      {children}
    </button>
  );
}

export function CampaignWizard() {
  const { t, lang } = useApp();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState({
    title: "",
    description: "",
    platforms: ["TikTok"] as string[],
    niche: "beauty",
    dos: "",
    donts: "",
    budget: 2_000_000,
    rate: 4000,
    deadline: "2026-12-15",
    length: "15–30s",
    creators: 5,
    location: "Dar es Salaam",
    minFollowers: 10_000,
    payment: "M-Pesa",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const valid = [
    f.title.trim() && f.description.trim() && f.platforms.length > 0,
    f.budget > 0 && f.rate >= MIN_RATE_PER_1K && f.creators >= 1 && f.deadline,
    true,
    true,
  ];
  const req = t("required");

  const next = async () => {
    setTried(true);
    if (!valid[step]) return;
    setTried(false);
    if (step < 3) return setStep(step + 1);
    setBusy(true);
    await fundCampaign(f);
    setBusy(false);
    setDone(true);
  };

  if (done)
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gradient-brand text-primary-foreground shadow-glow">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="mt-6 text-3xl font-bold">{t("successTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("successBody")}</p>
        <p className="mt-4 font-display text-xl font-semibold">
          <MoneyText value={f.budget} /> · {f.payment}
        </p>
        <Button asChild variant="hero" size="lg" className="mt-8 rounded-xl">
          <Link to="/campaigns">{t("viewCampaigns")}</Link>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold md:text-3xl">{t("createCampaign")}</h1>

      <ol className="flex items-center gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold",
                i < step
                  ? "bg-success text-success-foreground"
                  : i === step
                    ? "bg-gradient-brand text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden text-sm sm:block",
                i === step ? "font-semibold" : "text-muted-foreground",
              )}
            >
              {t(s)}
            </span>
            {i < 3 && (
              <span className={cn("h-0.5 flex-1 rounded", i < step ? "bg-success" : "bg-border")} />
            )}
          </li>
        ))}
      </ol>

      <Panel className="space-y-5">
        {step === 0 && (
          <>
            <Field label={t("title")} error={tried && !f.title.trim() ? req : undefined}>
              <input
                className={field}
                value={f.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Zuri Glow Serum Launch"
              />
            </Field>
            <Field
              label={t("description")}
              error={tried && !f.description.trim() ? req : undefined}
            >
              <textarea
                className={field}
                rows={3}
                value={f.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Show your morning skincare routine using the new serum."
              />
            </Field>
            <div>
              <p className="text-sm font-medium">{t("platforms")}</p>
              <div className="mt-2 flex gap-2">
                {["TikTok", "Instagram"].map((p) => (
                  <Chip
                    key={p}
                    active={f.platforms.includes(p)}
                    onClick={() =>
                      set(
                        "platforms",
                        f.platforms.includes(p)
                          ? f.platforms.filter((x) => x !== p)
                          : [...f.platforms, p],
                      )
                    }
                  >
                    {p}
                  </Chip>
                ))}
              </div>
              {tried && !f.platforms.length && (
                <p className="mt-1 text-xs text-destructive">{req}</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{t("niche")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {niches.map((n) => (
                  <Chip key={n} active={f.niche === n} onClick={() => set("niche", n)}>
                    <span className="capitalize">{n}</span>
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("dos")}>
                <textarea
                  className={field}
                  rows={3}
                  value={f.dos}
                  onChange={(e) => set("dos", e.target.value)}
                  placeholder="Show the product in the first 3 seconds"
                />
              </Field>
              <Field label={t("donts")}>
                <textarea
                  className={field}
                  rows={3}
                  value={f.donts}
                  onChange={(e) => set("donts", e.target.value)}
                  placeholder="Don't mention competitor brands"
                />
              </Field>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("totalBudget")} error={tried && f.budget <= 0 ? req : undefined}>
                <NumInput
                  className={cn(field, "tnum")}
                  value={f.budget}
                  onChange={(n) => set("budget", n)}
                />
              </Field>
              <Field label={t("rateInput")}>
                <NumInput
                  className={cn(field, "tnum")}
                  value={f.rate}
                  onChange={(n) => set("rate", n)}
                  aria-describedby="rate-help rate-msg"
                />
                <p id="rate-help" className="mt-1 text-xs text-muted-foreground">
                  Minimum rate: {formatTZS(MIN_RATE_PER_1K)} per 1,000 views
                </p>
              </Field>
              <Field label={t("creatorsNeeded")} error={f.creators < 1 ? t("minOne") : undefined}>
                <input
                  type="number"
                  min={1}
                  className={cn(field, "tnum")}
                  value={f.creators}
                  onChange={(e) => set("creators", Math.floor(Number(e.target.value)))}
                />
              </Field>
            </div>
            {f.rate < MIN_RATE_PER_1K && (
              <p
                id="rate-msg"
                role="alert"
                className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm"
              >
                {t("minRateMsg")} <MoneyText value={MIN_RATE_PER_1K} className="font-semibold" />{" "}
                {t("minRateMsg2")}
              </p>
            )}
            <Field label={t("deadline")}>
              <input
                type="date"
                className={field}
                value={f.deadline}
                onChange={(e) => set("deadline", e.target.value)}
              />
            </Field>
            <div
              className="rounded-2xl bg-gradient-brand p-5 text-primary-foreground"
              aria-live="polite"
            >
              <p className="text-sm opacity-90">{t("estimate")}</p>
              <p className="font-display text-3xl font-bold">
                <ViewsText value={estimateViews(f.budget, f.rate)} />{" "}
                <span className="text-base font-medium">{t("verifiedViewsLower")}</span>
              </p>
            </div>
            <div className="rounded-2xl border bg-secondary p-5" aria-live="polite">
              <p className="text-sm">
                {t("eachCanEarn")}{" "}
                <MoneyText
                  value={creatorCap(f.budget, f.creators)}
                  className="font-display text-lg font-bold text-accent"
                />
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("viewsPerCreator1")}{" "}
                <ViewsText
                  value={estimateViews(creatorCap(f.budget, f.creators), f.rate)}
                  className="font-semibold text-foreground"
                />{" "}
                {t("viewsPerCreator2")}
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <p className="text-sm font-medium">{t("videoLength")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lengths.map((l) => (
                  <Chip key={l} active={f.length === l} onClick={() => set("length", l)}>
                    {l}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Field label={t("minFollowers")}>
                <NumInput
                  className={cn(field, "tnum")}
                  value={f.minFollowers}
                  onChange={(n) => set("minFollowers", n)}
                />
              </Field>
            </div>
            <Field label={t("location")}>
              <Select value={f.location} onValueChange={(value) => set("location", value)}>
                <SelectTrigger aria-label={t("location")} className={cn(field, "h-auto")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <dl className="grid gap-3 rounded-2xl bg-secondary p-4 text-sm sm:grid-cols-2">
              {[
                [t("title"), f.title],
                [t("platforms"), f.platforms.join(", ")],
                [
                  t("niche"),
                  <span key="n" className="capitalize">
                    {f.niche}
                  </span>,
                ],
                [t("totalBudget"), <MoneyText key="b" value={f.budget} />],
                [t("ratePer1k"), <MoneyText key="r" value={f.rate} />],
                [
                  t("estimatedViews"),
                  <ViewsText key="v" value={estimateViews(f.budget, f.rate)} />,
                ],
                [t("deadline"), formatDate(f.deadline, lang)],
                [t("creatorsNeeded"), f.creators],
                [
                  t("eachCanEarn"),
                  <MoneyText key="cap" value={creatorCap(f.budget, f.creators)} />,
                ],
                [t("location"), f.location],
                [t("minFollowers"), <ViewsText key="m" value={f.minFollowers} />],
              ].map(([k, v], i) => (
                <div key={i}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold">
                {t("payNowPrefix")}{" "}
                <MoneyText value={f.budget} className="font-display text-lg text-accent" />{" "}
                {t("payNowSuffix")}
              </p>
              <p className="text-xs text-muted-foreground sm:max-w-sm">{t("feeNotAdded")}</p>
            </div>
            <div>
              <p className="text-sm font-medium">{t("paymentMethod")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                {payments.map((p) => (
                  <button
                    key={p}
                    role="radio"
                    aria-checked={f.payment === p}
                    onClick={() => set("payment", p)}
                    className={cn(
                      "rounded-xl border p-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      f.payment === p ? "border-primary bg-primary/15" : "hover:border-primary/60",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 rounded-2xl border p-4 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <Percent className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {t("feeNote")}
              </p>
              <p className="flex items-start gap-2">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                {t("escrowFull")}
              </p>
            </div>
          </>
        )}
      </Panel>

      <div className="flex justify-between">
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={step === 0 || busy}
          onClick={() => setStep(step - 1)}
        >
          {t("back")}
        </Button>
        <Button variant="hero" size="lg" className="rounded-xl" disabled={busy} onClick={next}>
          {step === 3 ? (
            busy ? (
              t("funding")
            ) : (
              <>
                {t("fund")} · <MoneyText value={f.budget} />
              </>
            )
          ) : (
            t("next")
          )}
        </Button>
      </div>
    </div>
  );
}
