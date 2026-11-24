import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AppProvider } from "@/lib/i18n"

const m = vi.hoisted(() => ({
  getMyBrandId: vi.fn(),
  createBrandWith: vi.fn(),
  fetchWalletSummary: vi.fn(),
  fetchWalletStatement: vi.fn(),
  fetchBrandDeposits: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({}),
  isSupabaseMode: () => true,
}))
vi.mock("@/lib/wallet-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet-api")>()
  return { ...actual, ...m }
})

import { WalletFailure } from "@/lib/wallet-api"
import { LiveWallet } from "@/components/biboh/LiveWallet"

function setup(lang: "en" | "sw" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <AppProvider initialLang={lang}>
        <LiveWallet />
      </AppProvider>
    </QueryClientProvider>,
  )
}

const statementRows = [
  {
    entry_id: 2,
    occurred_at: "2026-11-20T10:00:00Z",
    kind: "campaign_funding",
    amount: -100000,
    balance_after: 25000,
    reference: null,
    campaign_id: "c1",
  },
  {
    entry_id: 1,
    occurred_at: "2026-11-19T10:00:00Z",
    kind: "deposit",
    amount: 125000,
    balance_after: 125000,
    reference: "DEP-1",
    campaign_id: null,
  },
  {
    entry_id: 0,
    occurred_at: "2026-11-18T10:00:00Z",
    kind: "mystery_code",
    amount: 1,
    balance_after: 1,
    reference: null,
    campaign_id: null,
  },
]

const depositRows = [
  {
    deposit_id: "d1",
    reference: "DEP-1",
    amount: 125000,
    status: "confirmed",
    created_at: "2026-11-19T09:00:00Z",
    confirmed_at: "2026-11-19T10:00:00Z",
  },
]

function brandReady() {
  m.getMyBrandId.mockResolvedValue("b1")
  m.fetchWalletSummary.mockResolvedValue(25000)
  m.fetchWalletStatement.mockResolvedValue(statementRows)
  m.fetchBrandDeposits.mockResolvedValue(depositRows)
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
})
afterEach(cleanup)

describe("LiveWallet", () => {
  it("shows the create-brand form when the user has no brand, then the wallet", async () => {
    m.getMyBrandId.mockResolvedValueOnce(null).mockResolvedValue("b1")
    m.createBrandWith.mockResolvedValue("b1")
    m.fetchWalletSummary.mockResolvedValue(0)
    m.fetchWalletStatement.mockResolvedValue([])
    m.fetchBrandDeposits.mockResolvedValue([])
    setup()

    const input = await screen.findByLabelText("Brand name")
    const create = screen.getByRole("button", { name: "Create brand" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)

    fireEvent.change(input, { target: { value: "Zuri" } })
    fireEvent.click(screen.getByRole("button", { name: "Create brand" }))

    expect(await screen.findByText("Available balance")).toBeTruthy()
    expect(m.createBrandWith).toHaveBeenCalledWith(expect.anything(), "Zuri")
    expect(await screen.findByText("No transactions yet.")).toBeTruthy()
    expect(await screen.findByText("No deposits yet.")).toBeTruthy()
  })

  it("shows a friendly message, not raw text, when creating a brand is refused", async () => {
    m.getMyBrandId.mockResolvedValue(null)
    m.createBrandWith.mockRejectedValue(new WalletFailure("notAllowed"))
    setup()

    fireEvent.change(await screen.findByLabelText("Brand name"), { target: { value: "Zuri" } })
    fireEvent.click(screen.getByRole("button", { name: "Create brand" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("You do not have access to this wallet.")
  })

  it("translates known ledger kinds and deposit statuses, and hides unknown codes", async () => {
    brandReady()
    setup()

    expect((await screen.findAllByText("Deposit")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Campaign funding").length).toBeGreaterThan(0)
    expect(screen.getByText("Confirmed")).toBeTruthy()
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0)
    expect(screen.queryByText("mystery_code")).toBeNull()
    expect(screen.queryByText("campaign_funding")).toBeNull()
  })

  it("keeps Top up disabled and says why", async () => {
    brandReady()
    setup()

    expect(await screen.findByText("Top-ups coming soon")).toBeTruthy()
    const topUp = screen.getByRole("button", { name: /top/i }) as HTMLButtonElement
    expect(topUp.disabled).toBe(true)
  })

  it("shows a network error with a working retry button", async () => {
    m.getMyBrandId.mockRejectedValue(new WalletFailure("network"))
    setup()

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("Network problem. Check your connection.")

    brandReady()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Available balance")).toBeTruthy()
  })

  it("shows a no-access message when the balance read is refused", async () => {
    brandReady()
    m.fetchWalletSummary.mockRejectedValue(new WalletFailure("notAllowed"))
    setup()

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("You do not have access to this wallet.")
  })

  it("renders in Swahili", async () => {
    brandReady()
    setup("sw")

    expect(await screen.findByText("Salio linalopatikana")).toBeTruthy()
    expect(screen.getByText("Taarifa ya akaunti")).toBeTruthy()
    expect(screen.getByText("Kuweka pesa kunakuja hivi karibuni")).toBeTruthy()
  })
})