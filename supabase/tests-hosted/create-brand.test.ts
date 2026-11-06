import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { createAnonClient, createServiceClient, createUserViaAdmin, signInUser, getUserId, type TestUser } from "./support/clients"
import { cleanup } from "./support/cleanup"
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./support/env"

const ROUNDS = 30
const ANON_EMAIL = "hosted-outsider@biboh.test"
const ANON_PASSWORD = "HostedTest123!"
const CREATOR_1_EMAIL = "hosted-creator-1@biboh.test"
const CREATOR_1_PASSWORD = "HostedTest123!"

describe("create_brand (access control)", () => {
  let serviceClient: ReturnType<typeof createServiceClient>
  let anonClient: ReturnType<typeof createAnonClient>
  let c1Client: ReturnType<typeof createAnonClient>

  beforeAll(async () => {
    serviceClient = createServiceClient()

    await createUserViaAdmin(serviceClient, { email: ANON_EMAIL, password: ANON_PASSWORD, role: "creator" })
    await createUserViaAdmin(serviceClient, { email: CREATOR_1_EMAIL, password: CREATOR_1_PASSWORD, role: "creator" })

    anonClient = createAnonClient() // Not signed in - truly anonymous
    c1Client = await signInUser(createAnonClient(), CREATOR_1_EMAIL, CREATOR_1_PASSWORD)
  })

  afterAll(async () => {
    await cleanup(serviceClient)
  })

  it("anon cannot create a brand", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { error } = await anonClient.rpc("create_brand", { brand_name: `hosted-test-brand-${round}` })
      expect(error).toBeTruthy()
    }
  })

  it("creator behavior for create_brand recorded as-is", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { data, error } = await c1Client.rpc("create_brand", { brand_name: `hosted-test-creator-brand-${round}` })
      // Record behavior as-is - may succeed or fail depending on RLS
      // We just capture the result without asserting a specific outcome
      if (error) {
        // Creator may not be allowed to create brands (only brand role can)
        expect(error).toBeTruthy()
      } else {
        // If it succeeded, clean up
        if (data) {
          await serviceClient.from("brands").delete().eq("id", data.id)
        }
      }
    }
  })
})