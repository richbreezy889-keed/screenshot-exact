import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServiceClient } from "./support/clients"
import {
  createBrand,
  createLiveCampaign,
  ensureCreatorRow,
  ensureUser,
} from "./support/fixtures"
import {
  fetchApplicants,
  fetchCampaignHeader,
  fetchSubmissions,
} from "../../src/lib/campaign-detail-api"

const service = createServiceClient()
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const short = run.slice(-8)
const email = (n: string) => `hd-${n}-${short}@biboh.test`

const userIds: string[] = []
const campaignIds: string[] = []

let owner: any
let intruder: any
let creatorA: any
let creatorB: any
let campaignId: string
let submissionId: string

async function applyTo(creator: any, pitch: string) {
  const { data, error } = await creator.client
    .from("applications")
    .insert({ campaign_id: campaignId, creator_id: creator.id, pitch })
    .select("id")
    .single()
  if (error) throw error
  return data.id as string
}

beforeAll(async () => {
  owner = await ensureUser(service, email("owner"), "brand")
  intruder = await ensureUser(service, email("intruder"), "brand")
  creatorA = await ensureUser(service, email("creator-a"), "creator")
  creatorB = await ensureUser(service, email("creator-b"), "creator")
  userIds.push(owner.id, intruder.id, creatorA.id, creatorB.id)

  const brandId = await createBrand(owner.client, `Hosted Detail ${run}`)
  await createBrand(intruder.client, `Hosted Detail Other ${run}`)

  const camp = await createLiveCampaign(owner.client, service, brandId, {
    title: `hosted-test-detail-${run}`,
    creators_needed: 2,
  })
  campaignId = camp.id
  campaignIds.push(campaignId)

  await ensureCreatorRow(creatorA.client)
  await ensureCreatorRow(creatorB.client)

  const appA = await applyTo(creatorA, "Pitch from A")
  await applyTo(creatorB, "Pitch from B")

  const social = await service.from("social_accounts").insert({
    creator_id: creatorA.id,
    platform: "tiktok",
    handle: `@a-${run}`,
    followers: 120000,
    avg_views: 30000,
  })
  if (social.error) throw social.error

  // Approve A, then A posts a video.
  const approve = await service
    .from("applications")
    .update({ status: "approved", reviewed_by: owner.id, reviewed_at: new Date().toISOString() })
    .eq("id", appA)
  if (approve.error) throw approve.error

  const sub = await creatorA.client
    .from("submissions")
    .insert({
      application_id: appA,
      campaign_id: campaignId,
      creator_id: creatorA.id,
      platform: "tiktok",
      video_url: `https://www.tiktok.com/@a/video/${run}`,
      posted_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (sub.error) throw sub.error
  submissionId = sub.data.id
})

afterAll(async () => {
  for (const id of campaignIds) {
    const { error } = await service.from("campaigns").delete().eq("id", id)
    if (error) console.warn(`cleanup: campaign ${id}: ${error.message}`)
  }
  for (const id of userIds) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.warn(`cleanup: user ${id}: ${error.message}`)
  }
})

describe("campaign detail reads against biboh-test", () => {
  it("the brand owner sees the header, both applicants and A's profile data", async () => {
    const header = await fetchCampaignHeader(owner.client, campaignId)
    expect(header?.id).toBe(campaignId)
    expect(Number(header?.budget)).toBe(1000000)

    const rows = await fetchApplicants(owner.client, campaignId)
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.creatorId === creatorA.id)!
    expect(a.pitch).toBe("Pitch from A")
    expect(a.followers).toEqual([{ platform: "tiktok", followers: 120000, avgViews: 30000 }])
    expect(a.name.length).toBeGreaterThan(0)
  })

  it("the brand owner sees the submission with the creator's name", async () => {
    const rows = await fetchSubmissions(owner.client, campaignId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(submissionId)
    expect(rows[0]!.creatorId).toBe(creatorA.id)
    expect(rows[0]!.videoUrl).toContain("tiktok.com")
  })

  it("another brand sees no applicants and no submissions", async () => {
    expect(await fetchApplicants(intruder.client, campaignId)).toEqual([])
    expect(await fetchSubmissions(intruder.client, campaignId)).toEqual([])
  })

  it("a creator sees only their own application, not other creators' pitches", async () => {
    const rows = await fetchApplicants(creatorB.client, campaignId)
    expect(rows.map((r) => r.creatorId)).toEqual([creatorB.id])
    expect(rows.map((r) => r.pitch)).not.toContain("Pitch from A")
  })

  it("a creator who did not post does not see another creator's video", async () => {
    expect(await fetchSubmissions(creatorB.client, campaignId)).toEqual([])
  })

  it("the budget of a live campaign stays private from creators and other brands", async () => {
    // The campaigns table row carries budget and cap. Only the brand may read it.
    expect(await fetchCampaignHeader(creatorB.client, campaignId)).toBeNull()
    expect(await fetchCampaignHeader(intruder.client, campaignId)).toBeNull()
  })
})