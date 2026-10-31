import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider, useApp } from "@/lib/i18n";
import { CampaignCard } from "@/components/biboh/CampaignCard";
import { campaigns, type Campaign } from "@/data/campaigns";

// CampaignCard only needs Link to render an anchor; a full router is unnecessary here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: { id?: string };
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to.replace("$id", params?.id ?? "")} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const campaign = (id: string): Campaign => {
  const found = campaigns.find((c) => c.id === id);
  if (!found) throw new Error(`Missing campaign ${id}`);
  return found;
};

function LangSwitch() {
  const { setLang } = useApp();
  return <button onClick={() => setLang("sw")}>sw</button>;
}

function renderCard(c: Campaign) {
  render(
    <AppProvider>
      <CampaignCard c={c} />
      <LangSwitch />
    </AppProvider>,
  );
}

describe("CampaignCard", () => {
  it("labels a draft budget as not funded instead of budget remaining", () => {
    renderCard(campaign("c5"));

    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Not funded")).toBeInTheDocument();
    expect(screen.queryByText("Budget remaining")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("0 views")).not.toBeInTheDocument();
  });

  it("shows a thin budget-used bar and verified views on live campaigns", () => {
    renderCard(campaign("c1"));

    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "16");
    expect(screen.getByText("16% used")).toBeInTheDocument();
    expect(screen.getByText("180.8K verified views")).toBeInTheDocument();
  });

  it("shows the bar and views on completed campaigns", () => {
    renderCard(campaign("c4"));

    expect(screen.getByText("Returned to you")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByText("37% used")).toBeInTheDocument();
    expect(screen.getByText("227.5K verified views")).toBeInTheDocument();
  });

  it("localises the draft budget label and badge", () => {
    renderCard(campaign("c5"));
    fireEvent.click(screen.getByRole("button", { name: "sw" }));

    expect(screen.getByText("Bajeti")).toBeInTheDocument();
    expect(screen.getByText("Haijalipiwa")).toBeInTheDocument();
    expect(screen.queryByText("Bajeti iliyobaki")).not.toBeInTheDocument();
  });
});
