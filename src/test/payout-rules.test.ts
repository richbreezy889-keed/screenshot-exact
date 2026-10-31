import { describe, expect, it } from "vitest";
import {
  campaignTotals,
  canApproveMore,
  checkpointDate,
  checkpointResult,
  computeStats,
  countApproved,
  creatorCap,
  creatorEarnings,
  escrowBalance,
  feeSplit,
  getCampaign,
} from "@/lib/api";
import { campaigns } from "@/data/campaigns";
import {
  campaignDetails,
  type Applicant,
  type ApplicantStatus,
  type LedgerEntry,
} from "@/data/campaignDetail";
import { creators } from "@/data/creators";
import { PLATFORM_FEE } from "@/data/config";

const applicants = (...statuses: ApplicantStatus[]): Applicant[] =>
  statuses.map((status, i) => ({ creatorId: `u${i + 1}`, status }));

describe("creatorCap", () => {
  it("splits the budget equally per slot, rounding down", () => {
    expect(creatorCap(1_000_000, 3)).toBe(333_333);
    expect(creatorCap(5_000_000, 10)).toBe(500_000);
  });

  it("handles a single slot and zero or invalid inputs", () => {
    expect(creatorCap(750_000, 1)).toBe(750_000);
    expect(creatorCap(0, 4)).toBe(0);
    expect(creatorCap(1_000_000, 0)).toBe(0);
    expect(creatorCap(-1_000, 4)).toBe(0);
  });
});

describe("creatorEarnings", () => {
  const cap = 500_000;

  it("pays the rate per 1,000 verified views below the cap", () => {
    expect(creatorEarnings(50_000, 4_000, cap)).toBe(200_000);
    expect(creatorEarnings(0, 4_000, cap)).toBe(0);
  });

  it("clamps earnings at the creator's share", () => {
    expect(creatorEarnings(1_000_000, 4_000, cap)).toBe(cap);
    expect(creatorEarnings(241_300, 4_500, cap)).toBe(cap);
  });

  it("never exceeds the cap when views are exactly enough to reach it", () => {
    expect(creatorEarnings(100_000, 5_000, cap)).toBe(cap);
  });
});

describe("feeSplit", () => {
  it("Biboh keeps 15% of each payout", () => {
    expect(PLATFORM_FEE).toBe(0.15);
    expect(feeSplit(100_000)).toEqual({ fee: 15_000, net: 85_000 });
  });

  it("rounds the fee and always balances to the gross", () => {
    const split = feeSplit(100_001);
    expect(split.fee).toBe(15_000);
    expect(split.fee + split.net).toBe(100_001);
  });

  it("returns zero for a zero payout", () => {
    expect(feeSplit(0)).toEqual({ fee: 0, net: 0 });
  });
});

describe("escrowBalance", () => {
  const ledger: LedgerEntry[] = [
    { id: "l1", kind: "funded", date: "2026-10-01", amount: 5_000_000 },
    { id: "l2", kind: "paidOut", date: "2026-10-20", amount: 1_381_590 },
    { id: "l3", kind: "fee", date: "2026-10-20", amount: 243_810 },
  ];

  it("subtracts creator payouts and the platform fee from funding", () => {
    expect(escrowBalance(ledger)).toBe(3_374_600);
  });

  it("subtracts refunds and never shows a negative balance", () => {
    expect(
      escrowBalance([
        ...ledger,
        { id: "l4", kind: "returned", date: "2026-11-01", amount: 1_000_000 },
      ]),
    ).toBe(2_374_600);
    expect(
      escrowBalance([
        ...ledger,
        { id: "l4", kind: "returned", date: "2026-11-01", amount: 4_000_000 },
      ]),
    ).toBe(0);
  });
});

describe("slot limit", () => {
  it("allows approving while slots remain", () => {
    expect(canApproveMore(0, 10)).toBe(true);
    expect(canApproveMore(8, 10)).toBe(true);
  });

  it("blocks approving once every slot is filled", () => {
    expect(canApproveMore(10, 10)).toBe(false);
    expect(canApproveMore(12, 12)).toBe(false);
    expect(canApproveMore(13, 12)).toBe(false);
  });

  it("drives the Approve button from the live approved count", () => {
    // Three slots, two approved: one slot still open, so Approve stays enabled.
    expect(canApproveMore(countApproved(applicants("approved", "approved", "pending")), 3)).toBe(
      true,
    );
    // All three slots approved: Approve is disabled.
    expect(canApproveMore(countApproved(applicants("approved", "approved", "approved")), 3)).toBe(
      false,
    );
  });
});

describe("approved count derivation", () => {
  it("counts only approved applicants", () => {
    expect(countApproved(applicants("approved", "approved", "declined", "pending"))).toBe(2);
    expect(countApproved([])).toBe(0);
  });

  it("matches creatorsApproved for every campaign's detail data", () => {
    for (const campaign of campaigns) {
      const detail = campaignDetails[campaign.id];
      const derived = countApproved(detail?.applicants ?? []);
      expect(derived, `${campaign.id} approved applicants`).toBe(campaign.creatorsApproved);
    }
  });

  it("only references real creators, without duplicates per campaign", () => {
    const ids = new Set(creators.map((c) => c.id));
    for (const [campaignId, detail] of Object.entries(campaignDetails)) {
      const seen = new Set<string>();
      for (const applicant of detail.applicants) {
        expect(ids.has(applicant.creatorId), `${campaignId} → ${applicant.creatorId}`).toBe(true);
        expect(
          seen.has(applicant.creatorId),
          `${campaignId} duplicate ${applicant.creatorId}`,
        ).toBe(false);
        seen.add(applicant.creatorId);
      }
    }
  });
});

/** Rolls the checkpoint rule over a campaign's result rows. */
function campaignRollup(campaign: (typeof campaigns)[number]) {
  const cap = creatorCap(campaign.budget, campaign.creatorsNeeded);
  const rows = (campaignDetails[campaign.id]?.results ?? []).map((r) => ({
    ...r,
    ...checkpointResult(r, campaign.ratePer1k, cap),
    uncapped: Math.floor((r.views / 1000) * campaign.ratePer1k),
  }));
  const paidRows = rows.filter((r) => r.checkpointPassed);
  return {
    cap,
    rows,
    paidRows,
    gross: paidRows.reduce((sum, r) => sum + r.earnings, 0),
    views: paidRows.reduce((sum, r) => sum + r.verifiedViews, 0),
    counting: rows.reduce((sum, r) => sum + r.countingViews, 0),
    atCap: paidRows.filter((r) => r.uncapped >= cap).length,
  };
}

describe("campaign money consistency", () => {
  it("spent equals the creators' earnings before fee from verified views", () => {
    for (const campaign of campaigns) {
      const { gross } = campaignRollup(campaign);
      expect(campaign.spent, `${campaign.id} spent`).toBe(gross);
    }
  });

  it("verified views equal the sum of verified result views", () => {
    for (const campaign of campaigns) {
      const { views } = campaignRollup(campaign);
      expect(campaign.views, `${campaign.id} views`).toBe(views);
    }
  });

  it("only one or two creators reach their share cap per campaign", () => {
    for (const campaign of campaigns) {
      const { paidRows, atCap } = campaignRollup(campaign);
      expect(atCap, `${campaign.id} creators at cap`).toBeLessThanOrEqual(2);
      if (paidRows.length > 1) {
        expect(atCap, `${campaign.id} creators below cap`).toBeLessThan(paidRows.length);
      }
    }
  });

  it("pays only creators approved for that campaign", () => {
    for (const campaign of campaigns) {
      const detail = campaignDetails[campaign.id];
      const approved = new Set(
        (detail?.applicants ?? []).filter((a) => a.status === "approved").map((a) => a.creatorId),
      );
      for (const result of detail?.results ?? []) {
        expect(approved.has(result.creatorId), `${campaign.id} → ${result.creatorId}`).toBe(true);
      }
    }
  });

  it("keeps dashboard totals derived from the campaign data", () => {
    const stats = computeStats(campaigns);
    const spent = campaigns.reduce((sum, c) => sum + campaignTotals(c).gross, 0);
    const views = campaigns.reduce((sum, c) => sum + campaignTotals(c).verifiedViews, 0);

    expect(stats.spend).toBe(spent);
    expect(stats.views).toBe(views);
    expect(stats.avgCpm).toBe(views ? Math.round((spent / views) * 1000) : 0);
    // Total spend must be the money actually paid to creators, not a separate figure.
    expect(stats.spend).toBe(spent);
  });
});

describe("checkpoint earnings rule", () => {
  const row = (postedAt: string, views: number) => ({
    creatorId: "u1",
    postUrl: "https://tiktok.com/@example/video/1",
    postedAt,
    views,
  });

  it("puts the checkpoint exactly 7 days after posting", () => {
    expect(checkpointDate("2026-10-15")).toBe("2026-10-22");
    expect(checkpointDate("2026-09-10")).toBe("2026-09-17");
  });

  it("pays checkpoint views once the checkpoint has passed", () => {
    const result = checkpointResult(row("2026-10-15", 50_000), 4_000, 500_000);
    expect(result.checkpointPassed).toBe(true);
    expect(result.verifiedViews).toBe(50_000);
    expect(result.countingViews).toBe(0);
    expect(result.earnings).toBe(200_000);
  });

  it("pays nothing while a post is still counting", () => {
    const result = checkpointResult(row("2026-10-16", 50_000), 4_000, 500_000);
    expect(result.checkpointPassed).toBe(false);
    expect(result.verifiedViews).toBe(0);
    expect(result.countingViews).toBe(50_000);
    expect(result.earnings).toBe(0);
  });

  it("caps verified earnings at the creator's share", () => {
    const result = checkpointResult(row("2026-10-01", 1_000_000), 5_000, 375_000);
    expect(result.earnings).toBe(375_000);
  });

  it("gives every result row a posting date", () => {
    for (const [campaignId, detail] of Object.entries(campaignDetails)) {
      for (const result of detail.results) {
        expect(result.postedAt, `${campaignId} → ${result.creatorId}`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });

  it("keeps counting views on live campaigns and verifies completed ones", () => {
    for (const campaign of campaigns) {
      const { counting, paidRows, rows } = campaignRollup(campaign);
      if (campaign.status === "live" && rows.length > 0) {
        expect(counting, `${campaign.id} counting`).toBeGreaterThan(0);
        expect(paidRows.length, `${campaign.id} verified posts`).toBeGreaterThan(0);
      }
      if (campaign.status === "completed") {
        expect(counting, `${campaign.id} counting`).toBe(0);
        expect(paidRows.length, `${campaign.id} verified posts`).toBe(rows.length);
      }
      expect(campaign.spent, `${campaign.id} spent`).toBe(campaignTotals(campaign).gross);
      expect(campaign.views, `${campaign.id} views`).toBe(campaignTotals(campaign).verifiedViews);
    }
  });
});

describe("payments ledger dates and escrow", () => {
  it("dates payouts and the fee at the latest checkpoint reached", async () => {
    const { ledger } = await getCampaign("c1");
    const payouts = ledger.filter((entry) => entry.kind === "paidOut" || entry.kind === "fee");
    expect(payouts).toHaveLength(2);
    for (const entry of payouts) expect(entry.date).toBe("2026-10-19");

    const completed = await getCampaign("c4");
    const completedPayouts = completed.ledger.filter(
      (entry) => entry.kind === "paidOut" || entry.kind === "fee",
    );
    for (const entry of completedPayouts) expect(entry.date).toBe("2026-09-17");
  });

  it("leaves only unspent budget in live escrow and nothing in completed escrow", async () => {
    const live = await getCampaign("c1");
    expect(escrowBalance(live.ledger)).toBe(live.campaign.budget - live.campaign.spent);

    const completed = await getCampaign("c4");
    expect(escrowBalance(completed.ledger)).toBe(0);
    const refund = completed.ledger.find((entry) => entry.kind === "returned");
    expect(refund?.amount).toBe(completed.campaign.budget - completed.campaign.spent);
  });

  it("does not fund a draft campaign", async () => {
    const draft = await getCampaign("c5");
    expect(draft.ledger.some((entry) => entry.kind === "funded")).toBe(false);
    expect(escrowBalance(draft.ledger)).toBe(0);
  });
});
