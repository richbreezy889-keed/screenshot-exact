import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AppProvider, dict } from "@/lib/i18n"

const m = vi.hoisted(() => ({
  fetchCampaignHeader: vi.fn(),
  fetchApplicants: vi.fn(),
  fetchSubmissions: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({}),
  isSupabaseMode: () => true,
}))
vi.mock("@/lib/campaign-detail-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/campaign-detail-api")>()
  return { ...actual, ...m }
})

import { LiveCampaignDetail } from "@/components/biboh/LiveCampaignDetail"

const en = (k: string) => (dict as any)[k].en as string
const sw = (k: string) => (dict as any)[k].sw as string

function setup(lang: "en" | "sw" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <AppProvider initialLang={lang}>
        <LiveCampaignDetail id="c1" />
      </AppProvider>
    </QueryClientProvider>,
  )
}

const header = {
  id: "c1",
  title: "Zuri Launch",
  status: "draft",
  rate_per_1k: 2500,
  budget: 1000000,
  creator_cap: 500000,
  creators_needed: 2,
  deadline: "2026-12-31",
  platforms: ["tiktok"],
  niche: "beauty",
}

const applicants = [
  {
    applicationId: "a1",
    creatorId: "u1",
    status: "applied",
    pitch: "I love this brand",
    appliedAt: "2026-11-20T10:00:00Z",
    name: "Amina Juma",
    handle: "@amina",
    niche: "beauty",
    location: "Dar es Salaam",
    rating: 4.6,
    pastCampaigns: 3,
    followers: [{ platform: "tiktok", followers: 120000, avgViews: 30000 }],
  },
  {
    applicationId: "a2",
    creatorId: "u2",
    status: "mystery_status",
    pitch: null,
    appliedAt: "2026-11-21T10:00:00Z",
    name: "Neema",
    handle: "@neema",
    niche: null,
    location: null,
    rating: 0,
    pastCampaigns: 0,
    followers: [],
  },
]

const submissions = [
  {
    id: "s1",
    creatorId: "u1",
    creatorName: "Amina Juma",
    creatorHandle: "@amina",
    platform: "tiktok",
    videoUrl: "https://www.tiktok.com/@amina/video/1",
    postedAt: "2026-11-20T10:00:00Z",
    status: "awaiting",
    note: null,
  },
  {
    id: "s2",
    creatorId: "u2",
    creatorName: "Neema",
    creatorHandle: "@neema",
    platform: "tiktok",
    videoUrl: "javascript:alert(1)",
    postedAt: "2026-11-21T10:00:00Z",
    status: "approved",
    note: "Looks good",
  },
]

function ready() {
  m.fetchCampaignHeader.mockResolvedValue(header)
  m.fetchApplicants.mockResolvedValue(applicants)
  m.fetchSubmissions.mockResolvedValue(submissions)
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
})
afterEach(cleanup)

describe("LiveCampaignDetail", () => {
  it("shows the campaign and its applicants with profile details", async () => {
    ready()
    setup()

    expect(await screen.findByText("Zuri Launch")).toBeTruthy()
    expect(m.fetchCampaignHeader).toHaveBeenCalledWith(expect.anything(), "c1")
    expect(await screen.findByText("Amina Juma")).toBeTruthy()
    expect(screen.getByText("I love this brand")).toBeTruthy()
    expect(screen.getByText("Dar es Salaam")).toBeTruthy()
    expect(screen.getByText(en("detailLive.noPitch"))).toBeTruthy()
  })

  it("has no approve or decline buttons in this read-only version", async () => {
    ready()
    setup()

    await screen.findByText("Amina Juma")
    expect(screen.queryByRole("button", { name: en("approve") })).toBeNull()
    expect(screen.queryByRole("button", { name: en("decline") })).toBeNull()
    expect(screen.getAllByText(en("detailLive.actionsSoon")).length).toBeGreaterThan(0)
  })

  it("hides unknown status codes behind 'Other'", async () => {
    ready()
    setup()

    await screen.findByText("Neema")
    expect(screen.queryByText("mystery_status")).toBeNull()
    expect(screen.getByText(en("detailLive.statusOther"))).toBeTruthy()
  })

  it("lists submissions and only links to safe web addresses", async () => {
    ready()
    setup()
    await screen.findByText("Amina Juma")

    fireEvent.click(screen.getByRole("tab", { name: en("tabContent") }))

    expect(await screen.findByText("Looks good")).toBeTruthy()
    const links = screen.getAllByRole("link", { name: en("detailLive.openVideo") })
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute("href")).toBe("https://www.tiktok.com/@amina/video/1")
    expect(links[0]!.getAttribute("rel")).toContain("noopener")
  })

  it("says results and payments are coming soon", async () => {
    ready()
    setup()
    await screen.findByText("Zuri Launch")

    fireEvent.click(screen.getByRole("tab", { name: en("tabResults") }))
    expect(screen.getByText(en("detailLive.resultsPaymentsSoon"))).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: en("tabPayments") }))
    expect(screen.getByText(en("detailLive.resultsPaymentsSoon"))).toBeTruthy()
  })

  it("shows not-found when the campaign is not visible and loads nothing else", async () => {
    m.fetchCampaignHeader.mockResolvedValue(null)
    setup()

    expect(await screen.findByText(en("notFound"))).toBeTruthy()
    expect(m.fetchApplicants).not.toHaveBeenCalled()
    expect(m.fetchSubmissions).not.toHaveBeenCalled()
  })

  it("renders in Swahili", async () => {
    ready()
    setup("sw")

    expect(await screen.findByText("Zuri Launch")).toBeTruthy()
    expect(screen.getAllByText(sw("detailLive.actionsSoon")).length).toBeGreaterThan(0)
  })
})