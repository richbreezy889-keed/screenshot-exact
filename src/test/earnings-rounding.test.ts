import { describe, expect, it } from "vitest";
import { creatorEarnings, feeSplit } from "@/lib/api";

describe("earnings rounding", () => {
  it("pays the exact whole-shilling amount for the views at the checkpoint", () => {
    expect(creatorEarnings(1001, 2000, 10_000_000)).toBe(2002);
    for (const rate of [2000, 2500, 3000, 4000, 5000, 7500]) {
      for (let views = 1; views <= 20_000; views += 1) {
        const product = views * rate;
        const exact = (product - (product % 1000)) / 1000;
        expect(creatorEarnings(views, rate, Number.MAX_SAFE_INTEGER)).toBe(exact);
      }
    }
  });

  it("still applies the creator's cap", () => {
    expect(creatorEarnings(1_000_000, 4000, 500_000)).toBe(500_000);
  });

  it("rounds the fee to the nearest shilling", () => {
    for (let gross = 1; gross <= 20_000; gross += 1) {
      expect(feeSplit(gross).fee).toBe(Math.floor((gross * 15 + 50) / 100));
    }
  });
});