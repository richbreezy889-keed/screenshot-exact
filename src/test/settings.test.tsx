import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppProvider } from "@/lib/i18n";
import { SettingsPage } from "@/routes/settings";
import { Toaster } from "@/components/ui/sonner";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderSettings = () =>
  render(
    <AppProvider>
      <SettingsPage />
      <Toaster />
    </AppProvider>,
  );

describe("settings page", () => {
  it("renders every settings section as a tab", () => {
    renderSettings();

    for (const label of [
      "Company profile",
      "Language & region",
      "Notifications",
      "Team",
      "Security",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("switches to notifications and toggles alerts with channels", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Notifications"));

    const first = screen.getByRole("switch", { name: "New applicant" });
    expect(first).toHaveAttribute("aria-checked", "true");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-checked", "false");
  });

  it("opens the invite member dialog and adds a member", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Team"));
    fireEvent.click(screen.getByText("Invite member"));

    const submit = screen.getByText("Send invite");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Zainabu S" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "zainabu@zuri.co.tz" } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    expect(screen.getByText("Zainabu S")).toBeInTheDocument();
  });

  it("shows remove actions for manageable members only", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Team"));

    const removeButtons = screen.getAllByText("Remove member");
    expect(removeButtons.length).toBe(2);
  });

  it("validates the new password before saving", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Security"));

    const newPassword = screen.getByLabelText("New password");
    const confirmPassword = screen.getByLabelText("Confirm password");
    fireEvent.change(newPassword, { target: { value: "short" } });
    fireEvent.change(confirmPassword, { target: { value: "short" } });
    fireEvent.click(screen.getByText("Save changes"));

    expect(newPassword).toHaveValue("short");
  });
});
