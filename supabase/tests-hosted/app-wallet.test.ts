import { afterAll, describe, expect, it } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import { signUpWith } from "../../src/lib/auth-api"
import {
  WalletFailure,
  createBrandWith,
  fetchBrandDeposits,
  fetchWalletStatement,
  fetchWalletSummary,
  getMyBrandId,
} from "../../src/lib/wallet-api"

const service = createServiceClient()
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const PASSWORD = "HostedTest123!"
const userIds: string[] = []
const brandIds: string[] = []

async function newBrandUser(name: string) {
  const client = createAnonClient()
  const result = await signUpWith(
    client as any,
    `hosted-app-wallet-${name}-${run}@biboh.test`,
    PASSWORD,
    `Wallet ${name}`,
    "brand",
  )
  expect(result).toEqual({ kind: "signed-in" })
  const { data } = await client.auth.getUser()
  const id = data.user?.id as string
  userIds.push(id)
  return { client, id }
}

afterAll(async () => {
  for (const id of brandIds) {
    const { error } = await service.from("brands").delete().eq("id", id)
    if (error) console.warn(`cleanup: brand ${id}: ${error.message}`)
  }
  for (const id of userIds) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.warn(`cleanup: user ${id}: ${error.message}`)
  }
})

describe("wallet data access against biboh-test", () => {
  it("a new user has no brand, then creates one and is found as a member", async () => {
    const { client, id } = await newBrandUser("owner")
    await expect(getMyBrandId(client as any, id)).resolves.toBeNull()

    const brandId = await createBrandWith(client as any, `Hosted Wallet ${run}`)
    brandIds.push(brandId)
    expect(brandId).toMatch(/^[0-9a-f-]{36}$/)

    await expect(getMyBrandId(client as any, id)).resolves.toBe(brandId)
  })

  it("a fresh brand has a zero balance, an empty statement and no deposits", async () => {
    const { client } = await newBrandUser("empty")
    const brandId = await createBrandWith(client as any, `Hosted Empty ${run}`)
    brandIds.push(brandId)

    await expect(fetchWalletSummary(client as any, brandId)).resolves.toBe(0)
    await expect(fetchWalletStatement(client as any, brandId)).resolves.toEqual([])
    await expect(fetchBrandDeposits(client as any, brandId)).resolves.toEqual([])
  })

  it("a confirmed deposit shows in the balance, statement and deposit list", async () => {
    const { client } = await newBrandUser("deposit")
    const brandId = await createBrandWith(client as any, `Hosted Deposit ${run}`)
    brandIds.push(brandId)

    const req = await client.rpc("request_deposit", {
      p_brand_id: brandId,
      p_amount: 25000,
    })
    expect(req.error).toBeNull()
    const reference = (req.data as any)?.reference ?? (req.data as any)?.[0]?.reference
    expect(reference).toBeTruthy()

    const confirm = await service.rpc("confirm_deposit", {
      p_reference: reference,
      p_provider_ref: `hosted-${run}`,
      p_amount: 25000,
      p_provider: "selcom",
    })
    expect(confirm.error).toBeNull()

    await expect(fetchWalletSummary(client as any, brandId)).resolves.toBe(25000)

    const statement = await fetchWalletStatement(client as any, brandId)
    expect(statement).toHaveLength(1)
    expect(statement[0].kind).toBe("deposit")
    expect(Number(statement[0].amount)).toBe(25000)
    expect(Number(statement[0].balance_after)).toBe(25000)

    const deposits = await fetchBrandDeposits(client as any, brandId)
    expect(deposits).toHaveLength(1)
    expect(deposits[0].status).toBe("confirmed")
    expect(Number(deposits[0].amount)).toBe(25000)
  })

  it("a second user cannot read the first brand's wallet", async () => {
    const owner = await newBrandUser("victim")
    const brandId = await createBrandWith(owner.client as any, `Hosted Victim ${run}`)
    brandIds.push(brandId)

    const intruder = await newBrandUser("intruder")

    await expect(fetchWalletSummary(intruder.client as any, brandId)).rejects.toMatchObject({
      reason: "notAllowed",
    })
    await expect(fetchWalletStatement(intruder.client as any, brandId)).rejects.toBeInstanceOf(
      WalletFailure,
    )
    await expect(fetchBrandDeposits(intruder.client as any, brandId)).rejects.toBeInstanceOf(
      WalletFailure,
    )
    // And the intruder does not see the victim's membership row.
    await expect(getMyBrandId(intruder.client as any, intruder.id)).resolves.toBeNull()
  })
})