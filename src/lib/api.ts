// Mock data access layer. Swap these bodies for real database calls later.
import { creators as allCreators } from "@/data/creators";
import { campaigns, type Campaign, type CampaignStatus } from "@/data/campaigns";
import { creators } from "@/data/creators";
import { dailySeries, type AttentionItem } from "@/data/dashboard";
import {
  campaignDetails,
  type Applicant,
  type LedgerEntry,
  type ResultRow,
} from "@/data/campaignDetail";
import { MOCK_TODAY, PLATFORM_FEE } from "@/data/config";

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

export async function getCampaigns(status?: CampaignStatus | "all") {
  await delay();
  const list =
    !status || status === "all" ? campaigns : campaigns.filter((c) => c.status === status);
  return list.map(withTotals);
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
  return computeStats(campaigns.map(withTotals));
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

// ---- Checkpoint rule ----
// Every post is verified once, 7 days after it went live. Only the views
// recorded at that checkpoint are paid; later views stay unpaid. Posts still
// inside their window show their views as "counting".

const DAY_MS = 86_400_000;
const CHECKPOINT_DAYS = 7;

/** ISO date of a post's checkpoint (postedAt + 7 days). */
export function checkpointDate(postedAt: string) {
  return new Date(Date.parse(`${postedAt}T00:00:00Z`) + CHECKPOINT_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export interface CheckpointResult {
  checkpointDate: string;
  checkpointPassed: boolean;
  /** Views frozen at the checkpoint — zero until it passes. */
  verifiedViews: number;
  /** Views still inside their counting window — zero after it passes. */
  countingViews: number;
  /** Capped payout for the verified views — zero until the checkpoint passes. */
  earnings: number;
}

/**
 * The single source of truth for checkpoint earnings. `row.views` is the
 * checkpoint reading for posts whose checkpoint has passed, and the views so
 * far for posts still counting.
 */
export function checkpointResult(
  row: ResultRow,
  ratePer1k: number,
  cap: number,
  today = MOCK_TODAY,
): CheckpointResult {
  const date = checkpointDate(row.postedAt);
  const passed = date <= today;
  if (!passed) {
    return {
      checkpointDate: date,
      checkpointPassed: false,
      verifiedViews: 0,
      countingViews: row.views,
      earnings: 0,
    };
  }
  return {
    checkpointDate: date,
    checkpointPassed: true,
    verifiedViews: row.views,
    countingViews: 0,
    earnings: creatorEarnings(row.views, ratePer1k, cap),
  };
}

export interface CampaignTotals {
  verifiedViews: number;
  countingViews: number;
  gross: number;
  /** Latest checkpoint date that has passed, used to date the ledger. */
  latestCheckpoint: string | null;
}

/** Rolls the checkpoint rule up across every result row in a campaign. */
export function campaignTotals(campaign: Campaign): CampaignTotals {
  const cap = creatorCap(campaign.budget, campaign.creatorsNeeded);
  const rows = campaignDetails[campaign.id]?.results ?? [];
  let verifiedViews = 0;
  let countingViews = 0;
  let gross = 0;
  let latestCheckpoint: string | null = null;

  for (const row of rows) {
    const result = checkpointResult(row, campaign.ratePer1k, cap);
    verifiedViews += result.verifiedViews;
    countingViews += result.countingViews;
    gross += result.earnings;
    if (
      result.checkpointPassed &&
      (!latestCheckpoint || result.checkpointDate > latestCheckpoint)
    ) {
      latestCheckpoint = result.checkpointDate;
    }
  }

  return { verifiedViews, countingViews, gross, latestCheckpoint };
}

/** Campaign with its stored spend/views replaced by checkpoint-derived totals. */
function withTotals(campaign: Campaign): Campaign {
  const totals = campaignTotals(campaign);
  return { ...campaign, spent: totals.gross, views: totals.verifiedViews };
}

/** Funds still held for a campaign: funded minus creator payouts, fee and refunds. */
export function escrowBalance(ledger: LedgerEntry[]) {
  const balance = ledger.reduce((sum, entry) => {
    if (entry.kind === "funded") return sum + entry.amount;
    return sum - entry.amount;
  }, 0);
  // Mock ledgers can over-return by a few shillings; never show a negative escrow.
  return Math.max(0, balance);
}

export async function getCampaign(id: string) {
  await delay();
  const base = campaigns.find((x) => x.id === id);
  if (!base) throw new Error("not-found");
  const campaign = withTotals(base);
  const detail = campaignDetails[id] ?? {
    applicants: [],
    submissions: [],
    results: [],
    viewsOverTime: [],
  };
  const approved = countApproved(detail.applicants);
  const cap = creatorCap(base.budget, base.creatorsNeeded);
  const totals = campaignTotals(base);
  const { fee, net } = feeSplit(totals.gross);
  const ledger: LedgerEntry[] = [];
  // Drafts have not been funded, so there is nothing in escrow yet.
  if (campaign.status !== "draft") {
    ledger.push({ id: "l1", kind: "funded", date: "2026-10-01", amount: campaign.budget });
  }
  if (totals.gross > 0) {
    // Payouts happen at the latest checkpoint that has been reached.
    const paidDate = totals.latestCheckpoint ?? campaign.deadline;
    ledger.push({ id: "l2", kind: "paidOut", date: paidDate, amount: net });
    ledger.push({ id: "l3", kind: "fee", date: paidDate, amount: fee });
  }
  if (campaign.status === "completed")
    ledger.push({
      id: "l4",
      kind: "returned",
      date: campaign.deadline,
      amount: campaign.budget - totals.gross,
    });
  return { campaign, detail, ledger, cap, approved };
}

export function getCreatorById(id: string) {
  return allCreators.find((c) => c.id === id);
}

// ---- Dashboard attention ----
// Counts derive from the same data and checkpoint rule as the campaign pages.

const campaignById = (id: string) => campaigns.find((c) => c.id === id);

const awaitingVideos = (id: string) =>
  (campaignDetails[id]?.submissions ?? []).filter((s) => s.status === "awaiting").length;

const pendingApplicants = (id: string) =>
  (campaignDetails[id]?.applicants ?? []).filter((a) => a.status === "pending").length;

const countingViews = (id: string) => {
  const campaign = campaignById(id);
  return campaign ? campaignTotals(campaign).countingViews : 0;
};

const attentionCampaign = (id: string) => campaignById(id)?.title ?? id;

export const attentionItems: AttentionItem[] = [
  {
    id: "a1",
    kind: "approveVideo",
    campaignId: "c1",
    campaign: attentionCampaign("c1"),
    creator: "Neema Mushi",
    count: awaitingVideos("c1"),
  },
  {
    id: "a2",
    kind: "verifyViews",
    campaignId: "c3",
    campaign: attentionCampaign("c3"),
    creator: "",
    count: countingViews("c3"),
  },
  {
    id: "a3",
    kind: "applicants",
    campaignId: "c2",
    campaign: attentionCampaign("c2"),
    creator: "",
    count: pendingApplicants("c2"),
  },
  {
    id: "a4",
    kind: "approveVideo",
    campaignId: "c2",
    campaign: attentionCampaign("c2"),
    creator: "Juma Kassim",
    count: awaitingVideos("c2"),
  },
];
