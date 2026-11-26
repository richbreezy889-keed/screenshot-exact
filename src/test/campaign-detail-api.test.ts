import { describe, expect, it, vi } from "vitest"
import {
  fetchApplicants,
  fetchCampaignHeader,
  fetchSubmissions,
  safeHttpUrl,
} from "@/lib/campaign-detail-api"
import { dict } from "@/lib/i18n"

type Result = { data: unknown; error: unknown }

function chain(result: Result) {
  const obj: any = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    order: vi.fn(() => obj),
    limit: vi.fn(() => obj),
    maybeSingle: vi.fn(async () => result),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  }
  return obj
}

function client(tables: Record<string, Result>) {
  const chains: Record<string, any> = {}
  for (const [name, result] of Object.entries(tables)) chains[name] = chain(result)
  const sb = { from: vi.fn((name: string) => chains[name]) } as any
  return { sb, chains }
}

const ok = (data: unknown): Result => ({ data, error: null })

describe("fetchCampaignHeader", () => {
  it("reads one campaign by id and never selects everything", async () => {
    const row = { id: "c1", title: "Zuri" }
    const { sb, chains } = client({ campaigns: ok(row) })
    await expect(fetchCampaignHeader(sb, "c1")).resolves.toEqual(row)
    expect(chains["campaigns"].eq).toHaveBeenCalledWith("id", "c1")
    expect(chains["campaigns"].select.mock.calls[0][0]).not.toContain("*")
  })

  it("returns null when nothing is visible", async () => {
    const { sb } = client({ campaigns: ok(null) })
    await expect(fetchCampaignHeader(sb, "c1")).resolves.toBeNull()
  })

  it("throws a generic error, never raw text", async () => {
    const { sb } = client({ campaigns: { data: null, error: { message: "secret" } } })
    const err = await fetchCampaignHeader(sb, "c1").catch((e) => e)
    expect(err.message).toBe("campaign_detail_load_failed")
  })
})

describe("fetchApplicants", () => {
  it("returns an empty list without asking for creators when nobody applied", async () => {
    const { sb } = client({ applications: ok([]) })
    await expect(fetchApplicants(sb, "c1")).resolves.toEqual([])
    expect(sb.from).toHaveBeenCalledTimes(1)
  })

  it("merges applications with creator profiles and follower counts", async () => {
    const { sb, chains } = client({
      applications: ok([
        { id: "a1", creator_id: "u1", status: "applied", pitch: "Hi", created_at: "2026-11-20T10:00:00Z" },
        { id: "a2", creator_id: "u2", status: "approved", pitch: null, created_at: "2026-11-21T10:00:00Z" },
      ]),
      creators: ok([
        {
          id: "u1",
          display_name: "Amina",
          handle: "@amina",
          niche: "beauty",
          location: "Dar es Salaam",
          rating: 4.6,
          past_campaigns: 3,
        },
      ]),
      social_accounts: ok([
        { creator_id: "u1", platform: "tiktok", followers: 120000, avg_views: 30000 },
        { creator_id: "u1", platform: "instagram", followers: 5000, avg_views: 900 },
      ]),
    })
    const rows = await fetchApplicants(sb, "c1")

    expect(chains["applications"].eq).toHaveBeenCalledWith("campaign_id", "c1")
    expect(chains["creators"].in).toHaveBeenCalledWith("id", ["u1", "u2"])
    expect(chains["social_accounts"].in).toHaveBeenCalledWith("creator_id", ["u1", "u2"])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      applicationId: "a1",
      name: "Amina",
      handle: "@amina",
      rating: 4.6,
      pastCampaigns: 3,
      pitch: "Hi",
    })
    expect(rows[0]!.followers).toEqual([
      { platform: "tiktok", followers: 120000, avgViews: 30000 },
      { platform: "instagram", followers: 5000, avgViews: 900 },
    ])
  })

  it("falls back safely when a creator profile is not visible", async () => {
    const { sb } = client({
      applications: ok([
        { id: "a2", creator_id: "u2", status: "applied", pitch: null, created_at: "2026-11-21T10:00:00Z" },
      ]),
      creators: ok([]),
      social_accounts: ok([]),
    })
    const rows = await fetchApplicants(sb, "c1")
    expect(rows[0]).toMatchObject({ name: "", handle: "", rating: 0, followers: [] })
  })

  it("throws a generic error when any of the three reads fails", async () => {
    const apps = ok([
      { id: "a1", creator_id: "u1", status: "applied", pitch: null, created_at: "x" },
    ])
    const bad: Result = { data: null, error: { message: "secret" } }
    for (const tables of [
      { applications: bad },
      { applications: apps, creators: bad },
      { applications: apps, creators: ok([]), social_accounts: bad },
    ]) {
      const { sb } = client(tables as Record<string, Result>)
      const err = await fetchApplicants(sb, "c1").catch((e) => e)
      expect(err.message).toBe("campaign_detail_load_failed")
    }
  })
})

describe("fetchSubmissions", () => {
  it("returns an empty list without asking for creators when there are none", async () => {
    const { sb } = client({ submissions: ok([]) })
    await expect(fetchSubmissions(sb, "c1")).resolves.toEqual([])
    expect(sb.from).toHaveBeenCalledTimes(1)
  })

  it("adds creator names to each submission", async () => {
    const { sb, chains } = client({
      submissions: ok([
        {
          id: "s1",
          creator_id: "u1",
          platform: "tiktok",
          video_url: "https://example.com/v",
          posted_at: "2026-11-20T10:00:00Z",
          status: "awaiting",
          note: null,
          created_at: "2026-11-20T11:00:00Z",
        },
      ]),
      creators: ok([
        { id: "u1", display_name: "Amina", handle: "@amina", niche: null, location: null, rating: 4, past_campaigns: 0 },
      ]),
    })
    const rows = await fetchSubmissions(sb, "c1")
    expect(chains["submissions"].eq).toHaveBeenCalledWith("campaign_id", "c1")
    expect(rows[0]).toMatchObject({
      id: "s1",
      creatorName: "Amina",
      creatorHandle: "@amina",
      videoUrl: "https://example.com/v",
      status: "awaiting",
    })
  })
})

describe("safeHttpUrl", () => {
  it("allows http and https links", () => {
    expect(safeHttpUrl("https://www.tiktok.com/@a/video/1")).toBe("https://www.tiktok.com/@a/video/1")
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x")
  })

  it.each(["javascript:alert(1)", "data:text/html,hi", "ftp://x.com/f", "not a url", ""])(
    "rejects %s",
    (bad) => {
      expect(safeHttpUrl(bad)).toBeNull()
    },
  )
})

describe("detail translations", () => {
  const keys = Object.keys(dict).filter((k) => k.startsWith("detailLive."))

  it("has the expected number of keys", () => {
    expect(keys.length).toBe(7)
  })

  it.each(keys)("%s exists in English and Swahili", (key) => {
    const entry = (dict as any)[key]
    expect(entry.en.length).toBeGreaterThan(0)
    expect(entry.sw.length).toBeGreaterThan(0)
  })

  it.each(["applied", "approved", "rejected", "withdrawn", "awaiting", "revision"])(
    "has a label for status %s",
    (status) => {
      expect((dict as any)[status]).toBeDefined()
    },
  )
})