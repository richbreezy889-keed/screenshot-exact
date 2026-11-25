import { describe, expect, it, vi } from "vitest"
import { fetchBrandCampaigns } from "@/lib/campaigns-api"
import { dict } from "@/lib/i18n"

function chain(result: { data: unknown; error: unknown }) {
  const obj: any = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    order: vi.fn(() => obj),
    limit: vi.fn(() => obj),
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  }
  return { sb: { from: vi.fn(() => obj) } as any, obj }
}

describe("fetchBrandCampaigns", () => {
  it("reads the brand's campaigns, newest first, without a status filter for 'all'", async () => {
    const rows = [{ id: "c1", title: "A" }]
    const { sb, obj } = chain({ data: rows, error: null })
    await expect(fetchBrandCampaigns(sb, "b1", "all")).resolves.toEqual(rows)
    expect(sb.from).toHaveBeenCalledWith("campaigns")
    expect(obj.eq).toHaveBeenCalledTimes(1)
    expect(obj.eq).toHaveBeenCalledWith("brand_id", "b1")
    expect(obj.order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("adds a status filter for a specific tab", async () => {
    const { sb, obj } = chain({ data: [], error: null })
    await fetchBrandCampaigns(sb, "b1", "live")
    expect(obj.eq).toHaveBeenCalledWith("brand_id", "b1")
    expect(obj.eq).toHaveBeenCalledWith("status", "live")
  })

  it("never selects columns it does not show", async () => {
    const { sb, obj } = chain({ data: [], error: null })
    await fetchBrandCampaigns(sb, "b1")
    const cols = obj.select.mock.calls[0][0] as string
    expect(cols).not.toContain("*")
    expect(cols).not.toContain("creator_cap")
    expect(cols).not.toContain("brief")
  })

  it("returns an empty list when the database returns null", async () => {
    const { sb } = chain({ data: null, error: null })
    await expect(fetchBrandCampaigns(sb, "b1")).resolves.toEqual([])
  })

  it("throws a generic error, never raw database text", async () => {
    const { sb } = chain({ data: null, error: { message: "secret table detail" } })
    const err = await fetchBrandCampaigns(sb, "b1").catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("campaigns_load_failed")
  })
})

describe("campaign translations", () => {
  const keys = Object.keys(dict).filter((k) => k.startsWith("campaignsLive."))

  it("has the expected number of keys", () => {
    expect(keys.length).toBe(8)
  })

  it.each(keys)("%s exists in English and Swahili", (key) => {
    const entry = (dict as any)[key]
    expect(entry.en.length).toBeGreaterThan(0)
    expect(entry.sw.length).toBeGreaterThan(0)
  })

  it.each(["draft", "live", "paused", "completed", "cancelled"])(
    "has a label for status %s",
    (status) => {
      expect((dict as any)[`campaignsLive.status.${status}`]).toBeDefined()
    },
  )
})