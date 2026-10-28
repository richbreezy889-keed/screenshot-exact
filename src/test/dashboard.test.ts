import { describe, expect, it } from "vitest";
import { attentionItems, attentionTab, dailySeries } from "@/data/dashboard";
import { campaigns } from "@/data/campaigns";
import { campaignDetails } from "@/data/campaignDetail";
import { computeStats } from "@/lib/api";
import { recentViews } from "@/lib/views";

const lifetimeViews = campaigns.reduce((sum, c) => sum + c.views, 0);
const lifetimeSpend = campaigns.reduce((sum, c) => sum + c.spent, 0);
const seriesViews = dailySeries.reduce((sum, d) => sum + d.views, 0);
const seriesSpend = dailySeries.reduce((sum, d) => sum + d.spend, 0);

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe("dashboard 30-day series", () => {
  it("never exceeds the lifetime totals", () => {
    expect(seriesViews).toBeLessThanOrEqual(lifetimeViews);
    expect(seriesSpend).toBeLessThanOrEqual(lifetimeSpend);
  });

  it("covers roughly 55-70% of lifetime views and spend", () => {
    const viewsShare = seriesViews / lifetimeViews;
    const spendShare = seriesSpend / lifetimeSpend;
    expect(viewsShare).toBeGreaterThanOrEqual(0.55);
    expect(viewsShare).toBeLessThanOrEqual(0.7);
    expect(spendShare).toBeGreaterThanOrEqual(0.55);
    expect(spendShare).toBeLessThanOrEqual(0.7);
  });

  it("keeps spend per 1,000 views close to the dashboard average", () => {
    const { avgCpm } = computeStats(campaigns);
    const seriesCpm = (seriesSpend / seriesViews) * 1000;
    expect(Math.abs(seriesCpm - avgCpm)).toBeLessThan(avgCpm * 0.01);
    for (const day of dailySeries) {
      const dayCpm = (day.spend / day.views) * 1000;
      expect(Math.abs(dayCpm - avgCpm), `${day.date} CPM`).toBeLessThan(avgCpm * 0.08);
    }
  });

  it("varies the daily cost per 1,000 views around that average", () => {
    const cpm = dailySeries.map((day) => Math.round((day.spend / day.views) * 1000));
    expect(new Set(cpm).size).toBeGreaterThan(10);
    expect(Math.min(...cpm)).toBeLessThan(Math.max(...cpm) - 100);
  });

  it("has 30 ascending days ending 22 Oct 2026 with weekday variation and a rise", () => {
    expect(dailySeries).toHaveLength(30);
    expect(dailySeries.at(-1)?.date).toBe("2026-10-22");
    expect(dailySeries[0]?.date).toBe("2026-09-23");
    const dates = dailySeries.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);

    const weekend = dailySeries.filter((d) =>
      [0, 6].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay()),
    );
    const weekdays = dailySeries.filter(
      (d) => ![0, 6].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay()),
    );
    expect(average(weekend.map((d) => d.views))).toBeGreaterThan(
      average(weekdays.map((d) => d.views)) * 1.05,
    );

    const early = average(dailySeries.slice(0, 10).map((d) => d.views));
    const late = average(dailySeries.slice(-10).map((d) => d.views));
    expect(late).toBeGreaterThan(early);
  });
});

describe("needs your attention", () => {
  const awaitingVideos = (campaignId: string) =>
    (campaignDetails[campaignId]?.submissions ?? []).filter((s) => s.status === "awaiting").length;
  const pendingApplicants = (campaignId: string) =>
    (campaignDetails[campaignId]?.applicants ?? []).filter((a) => a.status === "pending").length;
  const recentCheckpointViews = (campaignId: string) =>
    recentViews(campaignDetails[campaignId]?.viewsOverTime ?? [], 7);

  it("counts match what the campaign pages show", () => {
    for (const item of attentionItems) {
      const expected =
        item.kind === "approveVideo"
          ? awaitingVideos(item.campaignId)
          : item.kind === "applicants"
            ? pendingApplicants(item.campaignId)
            : recentCheckpointViews(item.campaignId);
      expect(item.count, `${item.id} count`).toBe(expected);
      expect(item.count, `${item.id} should only surface real work`).toBeGreaterThan(0);
    }
  });

  it("asks to verify only a recent slice, not the whole campaign", () => {
    const verify = attentionItems.find((item) => item.kind === "verifyViews");
    expect(verify).toBeDefined();
    const campaign = campaigns.find((c) => c.id === verify?.campaignId);
    expect(campaign).toBeDefined();
    expect(verify?.count).toBeLessThan(campaign?.views ?? 0);
    expect(verify?.count).toBeLessThanOrEqual(Math.round((campaign?.views ?? 0) * 0.35));
  });

  it("names the campaign shown on the campaign page", () => {
    for (const item of attentionItems) {
      const campaign = campaigns.find((c) => c.id === item.campaignId);
      expect(campaign?.title, `${item.id} campaign`).toBe(item.campaign);
    }
  });

  it("links to the tab that holds the work", () => {
    for (const item of attentionItems) {
      expect(attentionTab[item.kind]).toBe(
        item.kind === "approveVideo"
          ? "content"
          : item.kind === "applicants"
            ? "applicants"
            : "results",
      );
    }
  });
});
