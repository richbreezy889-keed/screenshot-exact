import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/i18n";
import { MoneyText, Panel } from "@/components/biboh/primitives";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Biboh" },
      { name: "description", content: "Your Biboh escrow balance and payments." },
      { property: "og:title", content: "Wallet — Biboh" },
      { property: "og:description", content: "Your Biboh escrow balance and payments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold md:text-3xl">{t("wallet")}</h1>
      <div className="rounded-2xl bg-gradient-brand p-6 text-primary-foreground shadow-glow">
        <p className="text-sm opacity-90">{t("balance")}</p>
        <p className="mt-2 font-display text-3xl font-bold"><MoneyText value={8_230_000} /></p>
      </div>
      <Panel><p className="text-muted-foreground">{t("comingSoon")}</p></Panel>
    </div>
  );
}
