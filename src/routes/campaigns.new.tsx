import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Check, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { estimateViews, fundCampaign } from "@/lib/api";
import { useApp, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MoneyText, Panel, ViewsText } from "@/components/biboh/primitives";

export const Route = createFileRoute("/campaigns/new")({
  head: () => ({
    meta: [
      { title: "Create campaign — Biboh" },
      { name: "description", content: "Brief, budget and fund a new pay-per-view creator campaign." },
      { property: "og:title", content: "Create campaign — Biboh" },
      { property: "og:description", content: "Brief, budget and fund a new pay-per-view creator campaign." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Wizard,
});

const steps: TKey[] = ["stepBrief", "stepBudget", "stepReq", "stepReview"];
const niches = ["food", "fashion", "beauty", "comedy", "tech"];
const locations = ["Any", "Dar es Salaam", "Arusha", "Mwanza", "Dodoma"];
const lengths = ["15–30s", "30–60s", "60–90s"];
const payments = ["M-Pesa", "Mixx by Yas", "Airtel Money", "Card"];

const field = "mt-1.5 w-full rounded-xl border bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string | undefined }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:border-primary/60",
      )}
    >
      {children}
    </button>
  );
}

function Wizard() {
  const { t } = useApp();
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
    f.budget > 0 && f.rate > 0 && f.deadline,
    f.creators > 0,
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
        <p className="mt-4 font-display text-xl font-semibold"><MoneyText value={f.budget} /> · {f.payment}</p>
        <Button asChild variant="hero" size="lg" className="mt-8 rounded-xl"><Link to="/campaigns">{t("viewCampaigns")}</Link></Button>
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
                i < step ? "bg-success text-success-foreground" : i === step ? "bg-gradient-brand text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:block", i === step ? "font-semibold" : "text-muted-foreground")}>{t(s)}</span>
            {i < 3 && <span className={cn("h-0.5 flex-1 rounded", i < step ? "bg-success" : "bg-border")} />}
          </li>
        ))}
      </ol>

      <Panel className="space-y-5">
        {step === 0 && (
          <>
            <Field label={t("title")} error={tried && !f.title.trim() ? req : undefined}>
              <input className={field} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Zuri Glow Serum Launch" />
            </Field>
            <Field label={t("description")} error={tried && !f.description.trim() ? req : undefined}>
              <textarea className={field} rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Show your morning skincare routine using the new serum." />
            </Field>
            <div>
              <p className="text-sm font-medium">{t("platforms")}</p>
              <div className="mt-2 flex gap-2">
                {["TikTok", "Instagram"].map((p) => (
                  <Chip key={p} active={f.platforms.includes(p)} onClick={() => set("platforms", f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p])}>{p}</Chip>
                ))}
              </div>
              {tried && !f.platforms.length && <p className="mt-1 text-xs text-destructive">{req}</p>}
            </div>
            <div>
              <p className="text-sm font-medium">{t("niche")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {niches.map((n) => <Chip key={n} active={f.niche === n} onClick={() => set("niche", n)}><span className="capitalize">{n}</span></Chip>)}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("dos")}><textarea className={field} rows={3} value={f.dos} onChange={(e) => set("dos", e.target.value)} placeholder="Show the product in the first 3 seconds" /></Field>
              <Field label={t("donts")}><textarea className={field} rows={3} value={f.donts} onChange={(e) => set("donts", e.target.value)} placeholder="Don't mention competitor brands" /></Field>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("totalBudget")} error={tried && f.budget <= 0 ? req : undefined}>
                <input type="number" min={0} step={50000} className={cn(field, "tnum")} value={f.budget} onChange={(e) => set("budget", Number(e.target.value))} />
              </Field>
              <Field label={t("rateInput")} error={tried && f.rate <= 0 ? req : undefined}>
                <input type="number" min={0} step={100} className={cn(field, "tnum")} value={f.rate} onChange={(e) => set("rate", Number(e.target.value))} />
              </Field>
            </div>
            <Field label={t("deadline")}>
              <input type="date" className={field} value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </Field>
            <div className="rounded-2xl bg-gradient-brand p-5 text-primary-foreground" aria-live="polite">
              <p className="text-sm opacity-90">{t("estimate")}</p>
              <p className="font-display text-3xl font-bold"><ViewsText value={estimateViews(f.budget, f.rate)} /> <span className="text-base font-medium">{t("verifiedViewsLower")}</span></p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <p className="text-sm font-medium">{t("videoLength")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lengths.map((l) => <Chip key={l} active={f.length === l} onClick={() => set("length", l)}>{l}</Chip>)}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("numCreators")} error={tried && f.creators <= 0 ? req : undefined}>
                <input type="number" min={1} className={cn(field, "tnum")} value={f.creators} onChange={(e) => set("creators", Number(e.target.value))} />
              </Field>
              <Field label={t("minFollowers")}>
                <input type="number" min={0} step={1000} className={cn(field, "tnum")} value={f.minFollowers} onChange={(e) => set("minFollowers", Number(e.target.value))} />
              </Field>
            </div>
            <Field label={t("location")}>
              <select className={field} value={f.location} onChange={(e) => set("location", e.target.value)}>
                {locations.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <dl className="grid gap-3 rounded-2xl bg-secondary p-4 text-sm sm:grid-cols-2">
              {[
                [t("title"), f.title],
                [t("platforms"), f.platforms.join(", ")],
                [t("niche"), f.niche],
                [t("totalBudget"), <MoneyText key="b" value={f.budget} />],
                [t("ratePer1k"), <MoneyText key="r" value={f.rate} />],
                [t("verifiedViews"), <ViewsText key="v" value={estimateViews(f.budget, f.rate)} />],
                [t("deadline"), f.deadline],
                [t("numCreators"), f.creators],
                [t("location"), f.location],
                [t("minFollowers"), <ViewsText key="m" value={f.minFollowers} />],
              ].map(([k, v], i) => (
                <div key={i}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
              ))}
            </dl>
            <div>
              <p className="text-sm font-medium">{t("paymentMethod")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                {payments.map((p) => (
                  <button
                    key={p}
                    role="radio"
                    aria-checked={f.payment === p}
                    onClick={() => set("payment", p)}
                    className={cn("rounded-xl border p-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f.payment === p ? "border-primary bg-primary/15" : "hover:border-primary/60")}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-success" />{t("escrow")}</p>
          </>
        )}
      </Panel>

      <div className="flex justify-between">
        <Button variant="outline" className="rounded-xl" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>{t("back")}</Button>
        <Button variant="hero" size="lg" className="rounded-xl" disabled={busy} onClick={next}>
          {step === 3 ? (busy ? t("funding") : <>{t("fund")} · <MoneyText value={f.budget} /></>) : t("next")}
        </Button>
      </div>
    </div>
  );
}
