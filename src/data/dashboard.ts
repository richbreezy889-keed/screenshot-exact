import { campaigns } from "@/data/campaigns";
import { campaignDetails } from "@/data/campaignDetail";
import { recentViews } from "@/lib/views";

export interface DailyPoint {
  date: string;
  views: number;
  spend: number;
}

// ---- 30-day chart ----
// Derived from the campaign book so the chart can never claim more than the
// lifetime totals shown in the stat cards above it.
const WINDOW_DAYS = 30;
const WINDOW_END = Date.UTC(2026, 9, 22); // 22 Oct 2026
const DAY_MS = 86_400_000;
// Most campaigns started before this window, so the slice is a share of lifetime.
const WINDOW_SHARE = 0.63;

const lifetimeViews = campaigns.reduce((sum, c) => sum + c.views, 0);
const lifetimeSpend = campaigns.reduce((sum, c) => sum + c.spent, 0);
const blendedCpm = lifetimeViews ? (lifetimeSpend / lifetimeViews) * 1000 : 0;
const targetViews = Math.round(lifetimeViews * WINDOW_SHARE);
const targetSpend = Math.round(lifetimeSpend * WINDOW_SHARE);

// Weekday lift + gentle rise toward today, so the line still looks organic.
const weights = Array.from({ length: WINDOW_DAYS }, (_, i) => {
  const weekday = new Date(WINDOW_END - (WINDOW_DAYS - 1 - i) * DAY_MS).getUTCDay();
  const weekendLift = weekday === 0 || weekday === 6 ? 1.18 : 1;
  const rise = 0.78 + (i / (WINDOW_DAYS - 1)) * 0.42;
  const wave = 1 + 0.06 * Math.sin(i / 2.6);
  return weekendLift * rise * wave;
});
const weightTotal = weights.reduce((sum, w) => sum + w, 0);

// Some days buy views a little cheaper and some a little dearer. The wobble is
// deterministic and scaled back so the window still totals the same spend share.
const cpmWeights = Array.from(
  { length: WINDOW_DAYS },
  (_, i) => 1 + 0.04 * Math.sin(i / 1.7 + 0.6) + 0.015 * Math.cos(i / 4.3),
);
const rawSpend = weights.map((weight, i) => {
  const views = (weight / weightTotal) * targetViews;
  return (views / 1000) * blendedCpm * (cpmWeights[i] ?? 1);
});
const rawSpendTotal = rawSpend.reduce((sum, value) => sum + value, 0);
const spendScale = rawSpendTotal ? targetSpend / rawSpendTotal : 0;

// Deterministic 30-day series ending 22 Oct 2026.
export const dailySeries: DailyPoint[] = weights.map((weight, i) => {
  const date = new Date(WINDOW_END - (WINDOW_DAYS - 1 - i) * DAY_MS);
  const views = Math.round((weight / weightTotal) * targetViews);
  return {
    date: date.toISOString().slice(0, 10),
    views,
    spend: Math.round((rawSpend[i] ?? 0) * spendScale),
  };
});

export type AttentionKind = "approveVideo" | "verifyViews" | "applicants";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  campaignId: string;
  campaign: string;
  creator: string;
  count: number;
}

export const attentionTab: Record<AttentionKind, "content" | "results" | "applicants"> = {
  approveVideo: "content",
  verifyViews: "results",
  applicants: "applicants",
};

// Counts are derived from the campaign detail data so the dashboard and the
// campaign pages can never disagree.
const awaitingVideos = (id: string) =>
  (campaignDetails[id]?.submissions ?? []).filter((s) => s.status === "awaiting").length;

const pendingApplicants = (id: string) =>
  (campaignDetails[id]?.applicants ?? []).filter((a) => a.status === "pending").length;

// Only the most recent week of the campaign's cumulative series is waiting for
// verification, not the whole lifetime total.
const checkpointViews = (id: string) => recentViews(campaignDetails[id]?.viewsOverTime ?? [], 7);

export const attentionItems: AttentionItem[] = [
  {
    id: "a1",
    kind: "approveVideo",
    campaignId: "c1",
    campaign: "Zuri Glow Serum Launch",
    creator: "Neema Mushi",
    count: awaitingVideos("c1"),
  },
  {
    id: "a2",
    kind: "verifyViews",
    campaignId: "c3",
    campaign: "Mtaani Wear Street Drop",
    creator: "",
    count: checkpointViews("c3"),
  },
  {
    id: "a3",
    kind: "applicants",
    campaignId: "c2",
    campaign: "Kilele Morning Ritual",
    creator: "",
    count: pendingApplicants("c2"),
  },
  {
    id: "a4",
    kind: "approveVideo",
    campaignId: "c2",
    campaign: "Kilele Morning Ritual",
    creator: "Juma Kassim",
    count: awaitingVideos("c2"),
  },
];
