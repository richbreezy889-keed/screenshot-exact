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
