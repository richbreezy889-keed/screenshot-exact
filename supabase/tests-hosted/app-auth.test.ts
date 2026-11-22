import { afterAll, describe, expect, it } from "vitest"
import { createAnonClient, createServiceClient } from "./support/clients"
import {
  fetchRoleWith,
  signInWith,
  signUpWith,
} from "../../src/lib/auth-api"

const service = createServiceClient()
const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const PASSWORD = "HostedTest123!"
const created: string[] = []

const email = (name: string) => `hosted-app-auth-${name}-${run}@biboh.test`

async function idOf(client: ReturnType<typeof createAnonClient>) {
  const { data } = await client.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error("no signed-in user on client")
  created.push(id)
  return id
}

async function profileRole(id: string) {
  const { data, error } = await service
    .from("profiles")
    .select("role")
    .eq("id", id)
    .single()
  if (error) throw error
  return data.role as string
}

afterAll(async () => {
  for (const id of created) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.warn(`cleanup: could not delete ${id}: ${error.message}`)
  }
})

describe("app auth helpers against biboh-test", () => {
  it("signs up a brand and stores role brand in profiles", async () => {
    const client = createAnonClient()
    const result = await signUpWith(
      client as any,
      email("brand"),
      PASSWORD,
      "Hosted Brand",
      "brand",
    )
    expect(result).toEqual({ kind: "signed-in" })
    const id = await idOf(client)
    expect(await profileRole(id)).toBe("brand")
    expect(await fetchRoleWith(client as any, id)).toBe("brand")
  })

  it("signs up a creator and stores role creator in profiles", async () => {
    const client = createAnonClient()
    await signUpWith(
      client as any,
      email("creator"),
      PASSWORD,
      "Hosted Creator",
      "creator",
    )
    const id = await idOf(client)
    expect(await profileRole(id)).toBe("creator")
    expect(await fetchRoleWith(client as any, id)).toBe("creator")
  })

  it("the app helper refuses admin before reaching Supabase", async () => {
    const client = createAnonClient()
    await expect(
      signUpWith(client as any, email("admin-helper"), PASSWORD, "Eve", "admin" as any),
    ).rejects.toMatchObject({ key: "auth.cannotSelfRegisterAdmin" })
    // No user may have been created.
    const { data } = await service
      .from("profiles")
      .select("id")
      .eq("email", email("admin-helper"))
    expect(data ?? []).toHaveLength(0)
  })

  it("the trigger ignores role admin smuggled in raw metadata", async () => {
    const client = createAnonClient()
    const { data, error } = await client.auth.signUp({
      email: email("admin-raw"),
      password: PASSWORD,
      options: { data: { full_name: "Eve Raw", role: "admin" } },
    })
    expect(error).toBeNull()
    const id = data.user?.id
    expect(id).toBeTruthy()
    created.push(id as string)
    const role = await profileRole(id as string)
    expect(role).not.toBe("admin")
    expect(["brand", "creator"]).toContain(role)
  })

  it("maps a wrong password to auth.invalidCredentials, then signs in correctly", async () => {
    const addr = email("signin")
    const setup = createAnonClient()
    await signUpWith(setup as any, addr, PASSWORD, "Sign In", "brand")
    await idOf(setup)

    const fresh = createAnonClient()
    await expect(signInWith(fresh as any, addr, "WrongPass999")).rejects.toMatchObject({
      key: "auth.invalidCredentials",
    })

    await expect(signInWith(fresh as any, addr, PASSWORD)).resolves.toBeUndefined()
    const id = await idOf(fresh)
    expect(await fetchRoleWith(fresh as any, id)).toBe("brand")
  })

  it("maps a duplicate email to auth.emailAlreadyRegistered", async () => {
    const addr = email("dup")
    const first = createAnonClient()
    await signUpWith(first as any, addr, PASSWORD, "Dup One", "creator")
    await idOf(first)

    const second = createAnonClient()
    await expect(
      signUpWith(second as any, addr, PASSWORD, "Dup Two", "creator"),
    ).rejects.toMatchObject({ key: "auth.emailAlreadyRegistered" })
  })

  it("maps a too-short password to auth.weakPassword", async () => {
    const client = createAnonClient()
    await expect(
      signUpWith(client as any, email("weak"), "abc", "Weak Pass", "brand"),
    ).rejects.toMatchObject({ key: "auth.weakPassword" })
  })

  it("sign-out ends the session", async () => {
    const client = createAnonClient()
    await signUpWith(client as any, email("signout"), PASSWORD, "Sign Out", "brand")
    await idOf(client)
    expect((await client.auth.getSession()).data.session).not.toBeNull()

    const { error } = await client.auth.signOut()
    expect(error).toBeNull()
    expect((await client.auth.getSession()).data.session).toBeNull()
  })
})