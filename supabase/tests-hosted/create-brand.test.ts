import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { ensureUser, ensureCreatorRow, createBrand, type TestUser } from "./support/fixtures"

describe("create_brand (access control)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let brand: TestUser
  let victimBrand: TestUser
  let c1: TestUser
  const prefix = `hosted-test-brand-${Date.now()}`

  async function dropBrands() {
    try {
      await serviceClient.from("brands").delete().like("name", "hosted-test-brand-%")
    } catch {
      // Cleanup is best effort.
    }
  }

  beforeAll(async () => {
    serviceClient = createServiceClient()
    brand = await ensureUser(serviceClient, "hosted-brand-owner-2@biboh.test", "brand")
    victimBrand = await ensureUser(serviceClient, "hosted-brand-owner-1@biboh.test", "brand")
    c1 = await ensureUser(serviceClient, "hosted-creator-1@biboh.test", "creator")
    await ensureCreatorRow(c1.client)
  })

  afterAll(async () => {
    await dropBrands()
    await cleanup(serviceClient)
  })

  it("an anonymous visitor cannot create a brand", async () => {
    const { data, error } = await createAnonClient().rpc("create_brand", {
      brand_name: `${prefix}-anon`,
    })
    expect(error).not.toBeNull()
    expect(data ?? null).toBeNull()

    const { data: rows } = await serviceClient.from("brands").select("id").eq("name", `${prefix}-anon`)
    expect(rows ?? []).toHaveLength(0)
  })

  it("a creator account cannot create a brand", async () => {
    const { error } = await c1.client.rpc("create_brand", { brand_name: `${prefix}-creator` })
    expect(error).not.toBeNull()
    expect(error!.code).toBe("42501")

    const { data: rows } = await serviceClient
      .from("brands")
      .select("id")
      .eq("name", `${prefix}-creator`)
    expect(rows ?? []).toHaveLength(0)
  })

  it("a brand account can create a brand and becomes its owner", async () => {
    const brandId = await createBrand(brand.client, `${prefix}-ok`)
    expect(brandId).toBeTruthy()

    const { data, error } = await brand.client.rpc("brand_role", { target_brand_id: brandId })
    expect(error).toBeNull()
    expect(data).toBe("owner")
  })

  it("a brand name shorter than two characters is refused", async () => {
    const { error } = await brand.client.rpc("create_brand", { brand_name: " x " })
    expect(error).not.toBeNull()
    expect(error!.code).toBe("23514")
  })

  it("a creator cannot make themselves a member of someone else's brand", async () => {
    const victimBrandId = await createBrand(victimBrand.client, `${prefix}-victim`)

    await c1.client
      .from("brand_members")
      .insert({ brand_id: victimBrandId, user_id: c1.id, role: "owner" })

    const { data: rows, error } = await serviceClient
      .from("brand_members")
      .select("user_id")
      .eq("brand_id", victimBrandId)
      .eq("user_id", c1.id)
    if (error) throw error
    expect(rows ?? []).toHaveLength(0)

    const { data: role } = await c1.client.rpc("brand_role", { target_brand_id: victimBrandId })
    expect(role ?? null).toBeNull()
  })

  it("a brand owner cannot add themselves to another brand", async () => {
    const victimBrandId = await createBrand(victimBrand.client, `${prefix}-victim2`)

    await brand.client
      .from("brand_members")
      .insert({ brand_id: victimBrandId, user_id: brand.id, role: "owner" })

    const { data: rows, error } = await serviceClient
      .from("brand_members")
      .select("user_id")
      .eq("brand_id", victimBrandId)
      .eq("user_id", brand.id)
    if (error) throw error
    expect(rows ?? []).toHaveLength(0)
  })
})