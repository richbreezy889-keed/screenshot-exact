// Mock data access layer. Swap these bodies for real database calls later.
import { campaigns, type Campaign, type CampaignStatus } from "@/data/campaigns";
import { creators } from "@/data/creators";
import { attentionItems, dailySeries } from "@/data/dashboard";

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

export async function getCampaigns(status?: CampaignStatus | "all") {
  await delay();
  return !status || status === "all" ? campaigns : campaigns.filter((c) => c.status === status);
}

export async function getActiveCampaigns() {
  return getCampaigns("live");
}

export async function getCreators() {
  await delay();
  return creators;
}

export async function getDailySeries() {
  await delay();
  return dailySeries;
}

export async function getAttentionItems() {
  await delay();
  return attentionItems;
}

export function computeStats(list: Campaign[]) {
  const spend = list.reduce((s, c) => s + c.spent, 0);
  const views = list.reduce((s, c) => s + c.views, 0);
  return {
    spend,
    views,
    active: list.filter((c) => c.status === "live").length,
    avgCpm: views ? Math.round((spend / views) * 1000) : 0,
  };
}

export async function getStats() {
  await delay();
  return computeStats(campaigns);
}

/** Views a budget buys at a given rate per 1,000 views. */
export function estimateViews(budget: number, ratePer1k: number) {
  if (budget <= 0 || ratePer1k <= 0) return 0;
  return Math.floor((budget / ratePer1k) * 1000);
}

export async function fundCampaign(_input: Record<string, unknown>) {
  await delay(900);
  return { id: `c${Date.now()}` };
}
