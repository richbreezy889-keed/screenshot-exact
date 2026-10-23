import { describe, expect, it } from "vitest";
import { formatTZS, formatViews } from "@/lib/format";
import { estimateViews } from "@/lib/api";

describe("formatting rules", () => {
  it("formats TZS with no decimals", () => {
    expect(formatTZS(1250000)).toBe("TZS 1,250,000");
  });
  it("shortens views", () => {
    expect(formatViews(12400)).toBe("12.4K");
    expect(formatViews(1200000)).toBe("1.2M");
  });
  it("estimates views per 1,000 rate", () => {
    expect(estimateViews(5_000_000, 5000)).toBe(1_000_000);
  });
});

import { creatorCap, creatorEarnings, feeSplit } from "@/lib/api";
import { MIN_RATE_PER_1K } from "@/data/config";
describe("creator payout rules", () => {
  it("splits budget equally per creator, rounded down", () => {
    expect(creatorCap(1_000_000, 3)).toBe(333_333);
  });
  it("caps earnings at the creator's share", () => {
    expect(creatorEarnings(1_000_000, 4000, 500_000)).toBe(500_000);
  });
  it("Biboh keeps 15% of payout", () => {
    expect(feeSplit(100_000)).toEqual({ fee: 15_000, net: 85_000 });
  });
  it("min rate placeholder is 2,000 TZS", () => {
    expect(MIN_RATE_PER_1K).toBe(2000);
  });
});
