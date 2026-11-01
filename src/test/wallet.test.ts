import { describe, expect, it } from "vitest";
import { campaignBudgetBreakdown, computeStats } from "@/lib/api";
import { campaigns } from "@/data/campaigns";
import { MOCK_TOP_UPS, walletSnapshot, type MockTopUp } from "@/lib/wallet";

describe("wallet snapshot", () => {
  it("reconciles available, escrow, spent and returned", () => {
    const snap = walletSnapshot();

    expect(snap.topUps).toBe(20_000_000);
    expect(snap.inEscrow).toBe(10_491_400);
    expect(snap.spent).toBe(3_403_064);
    expect(snap.fee).toBe(510_460);
    expect(snap.returned).toBe(2_105_536);
    expect(snap.available).toBe(6_105_536);
    expect(snap.totalFunded).toBe(16_000_000);

    // topUps = available + escrow holds + spent, with returns already back in.
    expect(snap.available + snap.inEscrow + snap.spent).toBe(snap.topUps);
    // Funding = payout + refund + live escrow, so the books close.
    expect(snap.totalFunded).toBe(snap.spent + snap.returned + snap.inEscrow);
  });

  it("keeps the ledger running balance ending at the available balance", () => {
    const snap = walletSnapshot();
    const running = snap.entries.reduce((sum, entry) => sum + entry.balanceChange, 0);
    expect(running).toBe(snap.available);

    const byKind = snap.entries.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] ?? 0) + entry.balanceChange;
      return acc;
    }, {});
    expect(byKind["topUp"]).toBe(snap.topUps);
    expect(byKind["escrow"]).toBe(-snap.totalFunded);
    expect(byKind["payout"]).toBe(0);
    expect(byKind["returned"]).toBe(snap.returned);
  });

  it("sums ledger rows by kind to the wallet card totals", () => {
    const snap = walletSnapshot();

    const topUps = snap.entries.filter((e) => e.kind === "topUp").reduce((s, e) => s + e.amount, 0);
    const escrowHolds = snap.entries
      .filter((e) => e.kind === "escrow")
      .reduce((s, e) => s + Math.abs(e.amount), 0);
    const payouts = snap.entries
      .filter((e) => e.kind === "payout")
      .reduce((s, e) => s + (e.gross ?? 0), 0);
    const returns = snap.entries
      .filter((e) => e.kind === "returned")
      .reduce((s, e) => s + e.amount, 0);

    expect(topUps).toBe(snap.topUps);
    expect(escrowHolds).toBe(snap.totalFunded);
    expect(payouts).toBe(snap.spent);
    expect(returns).toBe(snap.returned);
  });

  it("adds a new top-up to the ledger and raises the available balance", () => {
    const extra: MockTopUp = {
      id: "t-test",
      date: "2026-10-22",
      amount: 1_000_000,
      method: "M-Pesa",
    };
    const snap = walletSnapshot([extra]);
    expect(snap.topUps).toBe(21_000_000);
    expect(snap.available).toBe(7_105_536);
  });

  it("keeps the wallet spent total equal to the dashboard spend", () => {
    expect(computeStats(campaigns).spend).toBe(3_403_064);
  });

  it("reserves counting views across live campaigns for the escrow card", () => {
    const snap = walletSnapshot();
    const reserved = campaigns
      .filter((c) => c.status === "live")
      .reduce((sum, c) => sum + campaignBudgetBreakdown(c).reserved, 0);
    expect(reserved).toBe(1_645_000);
    expect(snap.reserved).toBe(reserved);
  });
});
