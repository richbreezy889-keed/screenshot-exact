import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AppProvider } from "@/lib/i18n"

const m = vi.hoisted(() => ({
  getMyBrandId: vi.fn(),
  fetchBrandCampaigns: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({}),
  isSupabaseMode: () => true,
}))
vi.mock("@/lib/wallet-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet-api")>()
  return { ...actual, getMyBrandId: m.getMyBrandId }
})
vi.mock("@/lib/campaigns-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/campaigns-api")>()
  return { ...actual, fetchBrandCampaigns: m.fetchBrandCampaigns }
})

import { LiveCampaigns } from "@/components/biboh/LiveCampaigns"

function setup(lang: "en" | "sw" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <AppProvider initialLang={lang}>
        <LiveCampaigns />
      </AppProvider>
    </QueryClientProvider>,
  )
}

const rows = [
  {
    id: "c1",
    title: "Zuri Launch",
    status: "draft",
    niche: "beauty",
    platforms: ["tiktok"],
    budget: 1000000,
    rate_per_1k: 2500,
    creators_needed: 2,
    deadline: "2026-12-31",
    published_at: null,
    created_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "c2",
    title: "Weird One",
    status: "mystery_status",
    niche: null,
    platforms: [],
    budget: 500000,
    rate_per_1k: 2000,
    creators_needed: 1,
    deadline: "2026-12-31",
    published_at: null,
    created_at: "2026-11-19T10:00:00Z",
  },
]

beforeEach(() => {
  m.getMyBrandId.mockReset()
  m.fetchBrandCampaigns.mockReset()
})
afterEach(cleanup)

describe("LiveCampaigns", () => {
  it("lists the brand's campaigns from the database", async () => {
    m.getMyBrandId.mockResolvedValue("b1")
    m.fetchBrandCampaigns.mockResolvedValue(rows)
    setup()

    expect(await screen.findByText("Zuri Launch")).toBeTruthy()
    expect(screen.getByText("Weird One")).toBeTruthy()
    expect(m.fetchBrandCampaigns).toHaveBeenCalledWith(expect.anything(), "b1", "all")
  })

  it("translates known statuses and hides unknown codes", async () => {
    m.getMyBrandId.mockResolvedValue("b1")
    m.fetchBrandCampaigns.mockResolvedValue(rows)
    setup()

    await screen.findByText("Zuri Launch")
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(1) // tab + badge
    expect(screen.getByText("Other")).toBeTruthy()
    expect(screen.queryByText("mystery_status")).toBeNull()
  })

  it("refetches with the chosen status when a tab is clicked", async () => {
    m.getMyBrandId.mockResolvedValue("b1")
    m.fetchBrandCampaigns.mockResolvedValue(rows)
    setup()
    await screen.findByText("Zuri Launch")

    m.fetchBrandCampaigns.mockResolvedValue([])
    fireEvent.click(screen.getByRole("tab", { name: "Live" }))

    expect(await screen.findByText("No campaigns here yet.")).toBeTruthy()
    expect(m.fetchBrandCampaigns).toHaveBeenLastCalledWith(expect.anything(), "b1", "live")
  })

  it("shows the empty state and loads nothing when the user has no brand", async () => {
    m.getMyBrandId.mockResolvedValue(null)
    setup()

    expect(await screen.findByText("No campaigns here yet.")).toBeTruthy()
    expect(m.fetchBrandCampaigns).not.toHaveBeenCalled()
  })

  it("keeps Create campaign disabled and says why", async () => {
    m.getMyBrandId.mockResolvedValue("b1")
    m.fetchBrandCampaigns.mockResolvedValue([])
    setup()

    expect(await screen.findByText("Creating campaigns is coming soon")).toBeTruthy()
    const create = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
  })

  it("renders in Swahili", async () => {
    m.getMyBrandId.mockResolvedValue("b1")
    m.fetchBrandCampaigns.mockResolvedValue(rows)
    setup("sw")

    expect(await screen.findByText("Zuri Launch")).toBeTruthy()
    expect(screen.getByText("Kuunda kampeni kunakuja hivi karibuni")).toBeTruthy()
    expect(screen.getByText("Nyingine")).toBeTruthy()
  })
})