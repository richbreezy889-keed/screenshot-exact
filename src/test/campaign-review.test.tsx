import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppProvider } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { CampaignWizard } from "@/components/biboh/CampaignWizard";

afterEach(cleanup);

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

function reviewRow(label: string) {
  const term = [...document.querySelectorAll("dt")].find((el) => el.textContent === label);
  return term?.nextElementSibling as HTMLElement | null;
}

function reviewValue(label: string) {
  return reviewRow(label)?.textContent ?? null;
}

function renderWizard() {
  render(
    <AppProvider>
      <CampaignWizard />
    </AppProvider>,
  );
}

function fillBriefAndReachReview() {
  fireEvent.change(screen.getByLabelText("Campaign title"), {
    target: { value: "Zuri Glow Serum Launch" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Show the new serum in a morning routine." },
  });
  click("Next");
  click("Next");
  click("Next");
}

describe("campaign review step", () => {
  it("shows a localised deadline, the original location and estimated views", () => {
    renderWizard();
    fillBriefAndReachReview();

    expect(reviewValue("Deadline")).toBe(formatDate("2026-12-15", "en"));
    expect(reviewValue("Deadline")).not.toBe("2026-12-15");
    expect(reviewValue("Creator location")).toBe("Dar es Salaam");
    // The location must not be title-cased to "Dar Es Salaam".
    expect(reviewRow("Creator location")?.className).not.toContain("capitalize");
    expect(reviewValue("Estimated views")).toBe("500K");
    expect(screen.queryByText("Verified views")).not.toBeInTheDocument();
  });

  it("shows what the brand pays now and that the fee comes out of creator payouts", () => {
    renderWizard();
    fillBriefAndReachReview();

    expect(document.body.textContent).toContain("You pay TZS 2,000,000 now");
    expect(screen.getByText(/not added to your budget/)).toBeInTheDocument();
  });

  it("updates the review after going back and changing the creator count", () => {
    renderWizard();
    fillBriefAndReachReview();

    expect(reviewValue("Number of creators needed")).toBe("5");
    expect(reviewValue("Each creator can earn up to")).toContain("TZS 400,000");

    click("Back");
    click("Back");
    fireEvent.change(screen.getByLabelText("Number of creators needed"), {
      target: { value: "4" },
    });
    click("Next");
    click("Next");

    expect(reviewValue("Number of creators needed")).toBe("4");
    expect(reviewValue("Each creator can earn up to")).toContain("TZS 500,000");
  });
});
