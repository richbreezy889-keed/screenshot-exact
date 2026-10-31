import { createFileRoute } from "@tanstack/react-router";
import { CampaignWizard } from "@/components/biboh/CampaignWizard";

export const Route = createFileRoute("/campaigns/new")({
  head: () => ({
    meta: [
      { title: "Create campaign — Biboh" },
      {
        name: "description",
        content: "Brief, budget and fund a new pay-per-view creator campaign.",
      },
      { property: "og:title", content: "Create campaign — Biboh" },
      {
        property: "og:description",
        content: "Brief, budget and fund a new pay-per-view creator campaign.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignWizard,
});
