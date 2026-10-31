import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppProvider, LANG_COOKIE, useApp } from "@/lib/i18n";
import { AppShell } from "@/components/biboh/AppShell";

// AppShell only needs Link to render anchors; a full router is unnecessary here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  document.cookie = `${LANG_COOKIE}=; path=/; max-age=0`;
});

afterEach(cleanup);

function Probe() {
  const { lang, t } = useApp();
  return (
    <p data-testid="probe">
      {lang}:{t("dashboard")}
    </p>
  );
}

function LangButton() {
  const { setLang } = useApp();
  return <button onClick={() => setLang("sw")}>switch</button>;
}

describe("stored language", () => {
  it("renders the server-provided language on the very first render", () => {
    render(
      <AppProvider initialLang="sw">
        <Probe />
      </AppProvider>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("sw:Dashibodi");
    expect(document.documentElement.lang).toBe("sw");
  });

  it("writes the choice to a cookie and restores it on the next load", () => {
    const first = render(
      <AppProvider>
        <Probe />
        <LangButton />
      </AppProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("en:Dashboard");

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(document.cookie).toContain(`${LANG_COOKIE}=sw`);
    expect(screen.getByTestId("probe")).toHaveTextContent("sw:Dashibodi");

    // Simulate a reload: a fresh provider with no explicit language must start
    // from the stored cookie, never from English.
    first.unmount();
    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("sw:Dashibodi");
  });

  it("keeps both language options visible in the header toggle", () => {
    render(
      <AppProvider>
        <AppShell>content</AppShell>
      </AppProvider>,
    );

    const group = screen.getByRole("group", { name: "Language" });
    const options = within(group).getAllByRole("button");
    expect(options.map((option) => option.textContent)).toEqual(["en", "sw"]);
    expect(options[0]!).toHaveAttribute("aria-pressed", "true");
    expect(options[1]!).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(options[1]!);
    expect(options[0]!).toHaveAttribute("aria-pressed", "false");
    expect(options[1]!).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("Kampeni").length).toBeGreaterThan(0);
  });
});
