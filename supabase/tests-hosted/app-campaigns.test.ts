import { afterAll, describe, expect, it } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import { signUpWith } from "../../src/lib/auth-api"
import { createBrandWith } from "../../src/lib/wallet-api"
import { fetchBrandCampaigns } from "../../src/lib/campaigns-api"

const service = createServiceClient()
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const PASSWORD = "HostedTest123!"
const userIds: string[] = []
const brandIds: string[] = []
const campaignIds: string[] = []

async function newUser(name: string, role: "brand" | "creator") {
  const client = createAnonClient()
  const result = await signUpWith(
    client as any,
    `hosted-app-campaigns-${name}-${run}@biboh.test`,
    PASSWORD,
    `Campaigns ${name}`,
    role,
  )
  expect(result).toEqual({ kind: "signed-in" })
  const { data } = await client.auth.getUser()
  const id = data.user?.id as string
  userIds.push(id)
  return { client, id }
}

async function seedCampaign(brandId: string, createdBy: string, title: string) {
  const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await service
    .from("campaigns")
    .insert({
      brand_id: brandId,
      created_by: createdBy,
      title: `hosted-test-${title}-${run}`,
      budget: 1000000,
      rate_per_1k: 2500,
      creators_needed: 2,
      platforms: ["tiktok"], 
      deadline,
    })
    .select("id")
    .single()
  if (error) throw error
  campaignIds.push(data.id)
  return data.id as string
}

afterAll(async () => {
  for (const id of campaignIds) {
    const { error } = await service.from("campaigns").delete().eq("id", id)
    if (error) console.warn(`cleanup: campaign ${id}: ${error.message}`)
  }
  for (const id of brandIds) {
    const { error } = await service.from("brands").delete().eq("id", id)
    if (error) console.warn(`cleanup: brand ${id}: ${error.message}`)
  }
  for (const id of userIds) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.warn(`cleanup: user ${id}: ${error.message}`)
  }
})

describe("campaign reads against biboh-test", () => {
  it("a brand member sees its own campaign, with the stored figures", async () => {
    const owner = await newUser("owner", "brand")
    const brandId = await createBrandWith(owner.client as any, `Hosted Camp ${run}`)
    brandIds.push(brandId)
    const campaignId = await seedCampaign(brandId, owner.id, "own")

    const rows = await fetchBrandCampaigns(owner.client as any, brandId, "all")
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(campaignId)
    expect(Number(rows[0].budget)).toBe(1000000)
    expect(Number(rows[0].rate_per_1k)).toBe(2500)
    expect(rows[0].creators_needed).toBe(2)
  })

  it("status tabs filter: a draft shows under 'draft' and not under 'live'", async () => {
    const owner = await newUser("tabs", "brand")
    const brandId = await createBrandWith(owner.client as any, `Hosted Tabs ${run}`)
    brandIds.push(brandId)
    await seedCampaign(brandId, owner.id, "tabs")

    expect(await fetchBrandCampaigns(owner.client as any, brandId, "draft")).toHaveLength(1)
    expect(await fetchBrandCampaigns(owner.client as any, brandId, "live")).toHaveLength(0)
  })

  it("another brand cannot see the first brand's campaigns", async () => {
    const victim = await newUser("victim", "brand")
    const victimBrand = await createBrandWith(victim.client as any, `Hosted Victim ${run}`)
    brandIds.push(victimBrand)
    const campaignId = await seedCampaign(victimBrand, victim.id, "private")

    const intruder = await newUser("intruder", "brand")
    const intruderBrand = await createBrandWith(intruder.client as any, `Hosted Intruder ${run}`)
    brandIds.push(intruderBrand)

    // Asking for the victim's brand returns nothing.
    expect(await fetchBrandCampaigns(intruder.client as any, victimBrand, "all")).toEqual([])
    // And the campaign is invisible even when asked for by id.
    const direct = await intruder.client.from("campaigns").select("id,budget").eq("id", campaignId)
    expect(direct.data ?? []).toHaveLength(0)
  })

  it("a creator cannot read a draft campaign or its budget", async () => {
    const owner = await newUser("draftowner", "brand")
    const brandId = await createBrandWith(owner.client as any, `Hosted Draft ${run}`)
    brandIds.push(brandId)
    const campaignId = await seedCampaign(brandId, owner.id, "draft")

    const creator = await newUser("creator", "creator")
    const res = await creator.client.from("campaigns").select("id,budget").eq("id", campaignId)
    expect(res.data ?? []).toHaveLength(0)
  })

  it("a signed-out visitor cannot read campaigns", async () => {
    const owner = await newUser("anonowner", "brand")
    const brandId = await createBrandWith(owner.client as any, `Hosted Anon ${run}`)
    brandIds.push(brandId)
    const campaignId = await seedCampaign(brandId, owner.id, "anon")

    const anon = createAnonClient()
    const res = await anon.from("campaigns").select("id,budget").eq("id", campaignId)
    expect(res.data ?? []).toHaveLength(0)
  })
})