import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "@/lib/i18n";
import { CreatorProfile } from "@/routes/creators";
import { campaignsWithOpenSlots, openSlots } from "@/data/campaigns";
import { creators, recentCampaignsFor } from "@/data/creators";

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

afterEach(cleanup);

const creator = creators[0]!;

function Harness({ lang = "en" }: { lang?: "en" | "sw" }) {
  const [invitedCampaignId, setInvitedCampaignId] = useState<string | undefined>();
  return (
    <AppProvider initialLang={lang}>
      <CreatorProfile
        creator={creator}
        invitedCampaignId={invitedCampaignId}
        onInvite={setInvitedCampaignId}
      />
    </AppProvider>
  );
}

describe("creator invite picker", () => {
  it("only lists live or draft campaigns that still need creators", () => {
    expect(campaignsWithOpenSlots().map((c) => c.id)).toEqual(["c1", "c2", "c5"]);
    expect(campaignsWithOpenSlots().map(openSlots)).toEqual([2, 1, 15]);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Invite to campaign/i }));

    const picker = document.getElementById("invite-picker");
    expect(picker).not.toBeNull();
    expect(within(picker!).getByText("Zuri Glow Serum Launch")).toBeInTheDocument();
    expect(within(picker!).getByText("Kilele Morning Ritual")).toBeInTheDocument();
    expect(within(picker!).getByText("Zuri Holiday Gift Sets")).toBeInTheDocument();
    expect(within(picker!).queryByText("Mtaani Wear Street Drop")).not.toBeInTheDocument();
    expect(within(picker!).queryByText("Dar Bites Weekend Combo")).not.toBeInTheDocument();
  });

  it("marks the creator invited after selecting a campaign", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Invite to campaign/i }));

    const picker = document.getElementById("invite-picker")!;
    fireEvent.click(within(picker).getByRole("button", { name: /Zuri Glow Serum Launch/ }));

    expect(screen.getByText(/Invited · Zuri Glow Serum Launch/)).toBeInTheDocument();
    expect(document.getElementById("invite-picker")).toBeNull();

    // Re-opening the picker keeps the invitation and allows a different campaign.
    fireEvent.click(screen.getByRole("button", { name: /Invite to campaign/i }));
    fireEvent.click(
      within(document.getElementById("invite-picker")!).getByRole("button", {
        name: /Kilele Morning Ritual/,
      }),
    );
    expect(screen.getByText(/Invited · Kilele Morning Ritual/)).toBeInTheDocument();
  });

  it("shows the invitation and picker in Swahili", () => {
    render(<Harness lang="sw" />);
    fireEvent.click(screen.getByRole("button", { name: "Alika kwenye kampeni" }));

    expect(screen.getByText("Chagua kampeni")).toBeInTheDocument();
    const picker = document.getElementById("invite-picker")!;
    fireEvent.click(within(picker).getByRole("button", { name: /Zuri Glow Serum Launch/ }));

    expect(screen.getByText(/Amealikwa · Zuri Glow Serum Launch/)).toBeInTheDocument();
  });
});

describe("creator recent campaigns", () => {
  it("returns three mock rows per creator, newest first", () => {
    const rows = recentCampaignsFor(creator);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.views).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(row.date))).toBe(false);
    }
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort().reverse());
  });

  it("renders name, date and views for the three rows", () => {
    render(<Harness />);
    const region = screen.getByRole("region", { name: "Recent campaigns" });
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const shown = recentCampaignsFor(creator)[0]!;
    expect(within(region).getByText(shown.title)).toBeInTheDocument();
    expect(within(region).getByText(/84\.2K/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/2026/)).toBeInTheDocument();
  });
});
