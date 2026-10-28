// Mock data access layer. Swap these bodies for real database calls later.
import { creators as allCreators } from "@/data/creators";
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

// ---- Campaign detail ----
import { campaignDetails, type Applicant, type LedgerEntry } from "@/data/campaignDetail";
import { PLATFORM_FEE } from "@/data/config";

/** Number of applicants with status "approved" — the source of truth for the header count. */
export function countApproved(applicants: Applicant[]) {
  return applicants.filter((a) => a.status === "approved").length;
}

/** Whether another applicant can be approved without exceeding the campaign's slots. */
export function canApproveMore(approved: number, creatorsNeeded: number) {
  return approved < creatorsNeeded;
}

/** Max a single creator can earn: budget split equally across slots, rounded down. */
export function creatorCap(budget: number, creatorsNeeded: number) {
  if (budget <= 0 || creatorsNeeded < 1) return 0;
  return Math.floor(budget / creatorsNeeded);
}

/** Earnings before fee for a creator, capped at their share. */
export function creatorEarnings(views: number, ratePer1k: number, cap: number) {
  return Math.min(Math.floor((views / 1000) * ratePer1k), cap);
}

export function feeSplit(gross: number) {
  const fee = Math.round(gross * PLATFORM_FEE);
  return { fee, net: gross - fee };
}

export async function getCampaign(id: string) {
  await delay();
  const c = campaigns.find((x) => x.id === id);
  if (!c) throw new Error("not-found");
  const detail = campaignDetails[id] ?? {
    applicants: [],
    submissions: [],
    results: [],
    viewsOverTime: [],
  };
  const approved = countApproved(detail.applicants);
  const cap = creatorCap(c.budget, c.creatorsNeeded);
  const gross = detail.results.reduce((s, r) => s + creatorEarnings(r.views, c.ratePer1k, cap), 0);
  const { fee, net } = feeSplit(gross);
  const ledger: LedgerEntry[] = [
    { id: "l1", kind: "funded", date: "2026-10-01", amount: c.budget },
  ];
  if (gross > 0) {
    ledger.push({ id: "l2", kind: "paidOut", date: "2026-10-20", amount: net });
    ledger.push({ id: "l3", kind: "fee", date: "2026-10-20", amount: fee });
  }
  if (c.status === "completed")
    ledger.push({ id: "l4", kind: "returned", date: c.deadline, amount: c.budget - c.spent });
  return { campaign: c, detail, ledger, cap, approved };
}

export function getCreatorById(id: string) {
  return allCreators.find((c) => c.id === id);
}
