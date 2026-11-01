import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider } from "@/lib/i18n";
import { WalletPage } from "@/routes/wallet";
import { Toaster } from "@/components/ui/sonner";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  createFileRoute: () => () => ({}),
}));

const renderWallet = () =>
  render(
    <AppProvider>
      <WalletPage />
      <Toaster />
    </AppProvider>,
  );

describe("wallet top-up dialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("accepts valid Tanzanian phone numbers and rejects invalid ones for the confirm button", () => {
    renderWallet();
    fireEvent.click(screen.getByRole("button", { name: "Top up" }));

    const confirm = screen.getByRole("button", { name: "Confirm top-up" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "0712345678" } });
    expect(confirm).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+255712345678" } });
    expect(confirm).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "071243434356" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "07123" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "07123ab678" } });
    expect(confirm).toBeDisabled();
  });

  it("moves to the success state, shows the summary and mock reference, then closes", () => {
    renderWallet();
    fireEvent.click(screen.getByRole("button", { name: "Top up" }));

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "0712345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm top-up" }));

    expect(screen.getByText("Waiting for confirmation")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.getAllByText("Top-up confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText(/added via M-Pesa/)).toBeInTheDocument();
    expect(screen.getByText(/TU-2026-10-22/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Top up your wallet")).not.toBeInTheDocument();
  });
});
