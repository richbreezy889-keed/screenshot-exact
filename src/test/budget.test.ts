import { describe, expect, it } from "vitest";
import { campaignBudgetBreakdown } from "@/lib/api";
import { campaigns } from "@/data/campaigns";

const campaign = (id: string) => {
  const found = campaigns.find((c) => c.id === id);
  if (!found) throw new Error(`Missing campaign ${id}`);
  return found;
};

describe("campaign budget split", () => {
  it("spent + reserved + left equals the budget for every campaign", () => {
    for (const c of campaigns) {
      const split = campaignBudgetBreakdown(c);
      expect(split.spent + split.reserved + split.left, c.id).toBe(c.budget);
      expect(split.left, `${c.id} left`).toBeGreaterThanOrEqual(0);
      expect(split.reserved, `${c.id} reserved`).toBeGreaterThanOrEqual(0);
    }
  });

  it("reserves counting views at the campaign rate", () => {
    expect(campaignBudgetBreakdown(campaign("c1"))).toEqual({
      budget: 5_000_000,
      spent: 813_600,
      reserved: 770_000, // 541,800 and 270,000, each capped by the share
      left: 3_416_400,
    });
    expect(campaignBudgetBreakdown(campaign("c2"))).toEqual({
      budget: 3_000_000,
      spent: 532_000,
      reserved: 500_000, // 532,000 uncapped, limited to the 500,000 share
      left: 1_968_000,
    });
    expect(campaignBudgetBreakdown(campaign("c3"))).toEqual({
      budget: 4_500_000,
      spent: 663_000,
      reserved: 375_000, // 440,000 uncapped, limited to the 375,000 share
      left: 3_462_000,
    });
  });

  it("reserves nothing once every checkpoint has passed", () => {
    for (const c of campaigns.filter((x) => x.status === "completed")) {
      const split = campaignBudgetBreakdown(c);
      expect(split.reserved, `${c.id} reserved`).toBe(0);
      expect(split.left, `${c.id} left`).toBe(c.budget - split.spent);
    }
  });

  it("shows the whole budget as left for a draft", () => {
    const split = campaignBudgetBreakdown(campaign("c5"));
    expect(split).toEqual({ budget: 6_000_000, spent: 0, reserved: 0, left: 6_000_000 });
  });
});
