import { campaigns, type Campaign } from "@/data/campaigns";
import { campaignTotals, feeSplit } from "@/lib/api";

export type WalletEntryKind = "topUp" | "escrow" | "payout" | "returned";

export interface MockTopUp {
  id: string;
  date: string;
  amount: number;
  method: string;
}

export interface WalletEntry {
  id: string;
  kind: WalletEntryKind;
  date: string;
  /** How this entry moves the available balance. Payouts come out of escrow. */
  balanceChange: number;
  /** Signed cash flow shown in the amount column. */
  amount: number;
  /** Available balance after this entry. */
  balanceAfter: number;
  campaignId?: string;
  campaignTitle?: string;
  method?: string;
  /** Payout detail: gross, Biboh fee and net paid to the creator. */
  gross?: number;
  fee?: number;
  net?: number;
}

export interface WalletSnapshot {
  topUps: number;
  available: number;
  inEscrow: number;
  spent: number;
  fee: number;
  returned: number;
  /** Every campaign budget the brand has ever moved into escrow. */
  totalFunded: number;
  /** Newest first. */
  entries: WalletEntry[];
}

/** Mock wallet funding history, before any campaign was created. */
export const MOCK_TOP_UPS: MockTopUp[] = [
  { id: "t1", date: "2026-06-20", amount: 12_000_000, method: "Bank transfer" },
  { id: "t2", date: "2026-08-15", amount: 8_000_000, method: "M-Pesa" },
];

// When each campaign budget left the available balance for escrow. Drafts are
// never funded; the dates keep every campaign's hold before its payouts/refund.
const FUNDED_AT: Record<string, string> = {
  c1: "2026-10-01",
  c2: "2026-10-01",
  c3: "2026-10-01",
  c4: "2026-08-01",
  c6: "2026-07-15",
};

type DraftEntry = Omit<WalletEntry, "balanceAfter"> & { seq: number };

function campaignEntries(campaign: Campaign, seq: number): DraftEntry[] {
  if (campaign.status === "draft") return [];

  const totals = campaignTotals(campaign);
  const { fee, net } = feeSplit(totals.gross);
  const fundedAt = FUNDED_AT[campaign.id] ?? campaign.deadline;
  const entries: DraftEntry[] = [
    {
      id: `${campaign.id}-escrow`,
      kind: "escrow",
      date: fundedAt,
      amount: -campaign.budget,
      balanceChange: -campaign.budget,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      seq,
    },
  ];

  if (totals.gross > 0) {
    entries.push({
      id: `${campaign.id}-payout`,
      kind: "payout",
      date: totals.latestCheckpoint ?? campaign.deadline,
      amount: -totals.gross,
      balanceChange: 0,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      gross: totals.gross,
      fee,
      net,
      seq: seq + 1,
    });
  }

  if (campaign.status === "completed") {
    entries.push({
      id: `${campaign.id}-returned`,
      kind: "returned",
      date: campaign.deadline,
      amount: campaign.budget - totals.gross,
      balanceChange: campaign.budget - totals.gross,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      seq: seq + 2,
    });
  }

  return entries;
}

/**
 * Builds the wallet from the same campaign rules as the dashboard: escrow holds
 * are the funded budgets, payouts are checkpoint gross earnings, and only
 * completed campaigns return their unspent budget.
 */
export function walletSnapshot(extraTopUps: MockTopUp[] = []): WalletSnapshot {
  const topUps = [...MOCK_TOP_UPS, ...extraTopUps];
  const drafts: DraftEntry[] = topUps.map((topUp, index) => ({
    id: topUp.id,
    kind: "topUp",
    date: topUp.date,
    amount: topUp.amount,
    balanceChange: topUp.amount,
    method: topUp.method,
    seq: index,
  }));

  let spent = 0;
  let fee = 0;
  let returned = 0;
  let inEscrow = 0;
  let totalFunded = 0;

  campaigns.forEach((campaign, index) => {
    if (campaign.status === "draft") return;
    const totals = campaignTotals(campaign);
    totalFunded += campaign.budget;
    spent += totals.gross;
    fee += feeSplit(totals.gross).fee;
    if (campaign.status === "completed") {
      returned += campaign.budget - totals.gross;
    } else {
      inEscrow += campaign.budget - totals.gross;
    }
    drafts.push(...campaignEntries(campaign, 100 + index * 10));
  });

  const ascending = [...drafts].sort((a, b) =>
    a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date),
  );

  let balance = 0;
  const entries: WalletEntry[] = ascending.map((entry) => {
    balance += entry.balanceChange;
    const next: WalletEntry = {
      id: entry.id,
      kind: entry.kind,
      date: entry.date,
      balanceChange: entry.balanceChange,
      amount: entry.amount,
      balanceAfter: balance,
    };
    if (entry.campaignId) next.campaignId = entry.campaignId;
    if (entry.campaignTitle) next.campaignTitle = entry.campaignTitle;
    if (entry.method) next.method = entry.method;
    if (entry.gross !== undefined) {
      next.gross = entry.gross;
      if (entry.fee !== undefined) next.fee = entry.fee;
      if (entry.net !== undefined) next.net = entry.net;
    }
    return next;
  });

  const topUpTotal = topUps.reduce((sum, topUp) => sum + topUp.amount, 0);

  return {
    topUps: topUpTotal,
    available: topUpTotal - totalFunded + returned,
    inEscrow,
    spent,
    fee,
    returned,
    totalFunded,
    entries: entries.reverse(),
  };
}
