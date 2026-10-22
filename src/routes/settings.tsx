import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/i18n";
import { Panel } from "@/components/biboh/primitives";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Biboh" },
      { name: "description", content: "Manage your Biboh brand account settings." },
      { property: "og:title", content: "Settings — Biboh" },
      { property: "og:description", content: "Manage your Biboh brand account settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useApp();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold md:text-3xl">{t("settings")}</h1>
      <Panel><p className="text-muted-foreground">{t("comingSoon")}</p></Panel>
    </div>
  );
}
