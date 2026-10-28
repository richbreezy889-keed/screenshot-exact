import { describe, expect, it } from "vitest";
import {
  canApproveMore,
  computeStats,
  countApproved,
  creatorCap,
  creatorEarnings,
  feeSplit,
} from "@/lib/api";
import { campaigns } from "@/data/campaigns";
import { campaignDetails, type Applicant, type ApplicantStatus } from "@/data/campaignDetail";
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

/** Gross = every result row paid at the campaign rate, clamped to the creator's share. */
function campaignGross(campaign: (typeof campaigns)[number]) {
  const cap = creatorCap(campaign.budget, campaign.creatorsNeeded);
  const detail = campaignDetails[campaign.id];
  const rows = (detail?.results ?? []).map((r) => ({
    ...r,
    uncapped: Math.floor((r.views / 1000) * campaign.ratePer1k),
    paid: creatorEarnings(r.views, campaign.ratePer1k, cap),
  }));
  return {
    cap,
    rows,
    gross: rows.reduce((sum, r) => sum + r.paid, 0),
    views: rows.reduce((sum, r) => sum + r.views, 0),
    atCap: rows.filter((r) => r.uncapped >= cap).length,
  };
}

describe("campaign money consistency", () => {
  it("spent equals the creators' earnings before fee from the results", () => {
    for (const campaign of campaigns) {
      const { gross } = campaignGross(campaign);
      expect(campaign.spent, `${campaign.id} spent`).toBe(gross);
    }
  });

  it("verified views equal the sum of result views", () => {
    for (const campaign of campaigns) {
      const { views } = campaignGross(campaign);
      expect(campaign.views, `${campaign.id} views`).toBe(views);
    }
  });

  it("only one or two creators reach their share cap per campaign", () => {
    for (const campaign of campaigns) {
      const { rows, atCap } = campaignGross(campaign);
      expect(atCap, `${campaign.id} creators at cap`).toBeLessThanOrEqual(2);
      if (rows.length > 1) {
        expect(atCap, `${campaign.id} creators below cap`).toBeLessThan(rows.length);
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
    const spent = campaigns.reduce((sum, c) => sum + c.spent, 0);
    const views = campaigns.reduce((sum, c) => sum + c.views, 0);
    const gross = campaigns.reduce((sum, c) => sum + campaignGross(c).gross, 0);

    expect(stats.spend).toBe(spent);
    expect(stats.views).toBe(views);
    expect(stats.avgCpm).toBe(views ? Math.round((spent / views) * 1000) : 0);
    // Total spend must be the money actually paid to creators, not a separate figure.
    expect(stats.spend).toBe(gross);
  });
});
