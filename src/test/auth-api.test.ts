import { afterEach, describe, expect, it, vi } from "vitest"
import {
  fetchRoleWith,
  mapAuthError,
  signInWith,
  signUpWith,
} from "@/lib/auth-api"
import { dict } from "@/lib/i18n"

afterEach(() => vi.restoreAllMocks())

function authClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      ...overrides,
    },
  } as any
}

describe("signUpWith", () => {
  it("passes the chosen role and name in options.data", async () => {
    const sb = authClient()
    sb.auth.signUp.mockResolvedValue({
      data: { session: { access_token: "x" }, user: { id: "u1" } },
      error: null,
    })
    const result = await signUpWith(sb, "a@b.co", "password123", "Amina", "creator")
    expect(result).toEqual({ kind: "signed-in" })
    expect(sb.auth.signUp).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "password123",
      options: { data: { full_name: "Amina", role: "creator" } },
    })
  })

  it("rejects admin before calling Supabase", async () => {
    const sb = authClient()
    await expect(
      signUpWith(sb, "a@b.co", "password123", "Eve", "admin" as any),
    ).rejects.toMatchObject({ key: "auth.cannotSelfRegisterAdmin" })
    expect(sb.auth.signUp).not.toHaveBeenCalled()
  })

  it("returns needs-confirmation when there is a user but no session", async () => {
    const sb = authClient()
    sb.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: "u1" } },
      error: null,
    })
    await expect(
      signUpWith(sb, "a@b.co", "password123", "Amina", "brand"),
    ).resolves.toEqual({ kind: "needs-confirmation" })
  })

  it("throws an AuthFailure with a mapped key, never raw text", async () => {
    const sb = authClient()
    sb.auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: "user_already_exists", message: "raw server text" },
    })
    await expect(
      signUpWith(sb, "a@b.co", "password123", "Amina", "brand"),
    ).rejects.toMatchObject({ key: "auth.emailAlreadyRegistered" })
  })
})

describe("signInWith", () => {
  it("maps a failed sign-in to a key", async () => {
    const sb = authClient()
    sb.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    })
    await expect(signInWith(sb, "a@b.co", "bad")).rejects.toMatchObject({
      key: "auth.invalidCredentials",
    })
  })

  it("resolves on success", async () => {
    const sb = authClient()
    sb.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
    await expect(signInWith(sb, "a@b.co", "good")).resolves.toBeUndefined()
  })
})

describe("mapAuthError", () => {
  const cases: [string, unknown, string][] = [
    ["invalid code", { code: "invalid_credentials" }, "auth.invalidCredentials"],
    ["invalid message", { message: "Invalid login credentials" }, "auth.invalidCredentials"],
    [
      "not confirmed is not invalid credentials",
      { code: "email_not_confirmed", message: "Email not confirmed" },
      "auth.emailNotConfirmed",
    ],
    ["weak code", { code: "weak_password" }, "auth.weakPassword"],
    ["weak message", { message: "Password should be at least 6 characters" }, "auth.weakPassword"],
    ["exists", { code: "user_already_exists" }, "auth.emailAlreadyRegistered"],
    ["rate limit code", { code: "over_request_rate_limit" }, "auth.rateLimited"],
    ["rate limit status", { status: 429 }, "auth.rateLimited"],
    [
      "network",
      { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      "auth.networkFailure",
    ],
    ["unknown shape", {}, "auth.unknown"],
    ["unknown text", { message: "boom" }, "auth.unknown"],
    ["null", null, "auth.unknown"],
  ]
  it.each(cases)("%s", (_name, error, key) => {
    expect(mapAuthError(error)).toBe(key)
  })
})

describe("fetchRoleWith", () => {
  function profilesClient(result: { data: unknown; error: unknown }) {
    return {
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
      })),
    } as any
  }

  it("reads the role from the profiles table", async () => {
    const sb = profilesClient({ data: { role: "brand" }, error: null })
    await expect(fetchRoleWith(sb, "u1")).resolves.toBe("brand")
    expect(sb.from).toHaveBeenCalledWith("profiles")
  })

  it("returns null for a missing row, an error, or an unknown role", async () => {
    await expect(fetchRoleWith(profilesClient({ data: null, error: null }), "u1")).resolves.toBeNull()
    await expect(fetchRoleWith(profilesClient({ data: null, error: { message: "x" } }), "u1")).resolves.toBeNull()
    await expect(fetchRoleWith(profilesClient({ data: { role: "superuser" }, error: null }), "u1")).resolves.toBeNull()
  })
})

describe("auth translations", () => {
  const used = [
    "auth.signIn", "auth.signUp", "auth.signOut", "auth.email", "auth.password",
    "auth.fullName", "auth.role", "auth.brand", "auth.creator", "auth.noAccount",
    "auth.haveAccount", "auth.working", "auth.checkingEmail",
    "auth.cannotSelfRegisterAdmin", "auth.supabaseNotConfigured",
    "auth.invalidCredentials", "auth.weakPassword", "auth.emailAlreadyRegistered",
    "auth.emailNotConfirmed", "auth.rateLimited", "auth.networkFailure", "auth.unknown",
  ]
  it.each(used)("%s exists in English and Swahili", (key) => {
    const entry = (dict as any)[key]
    expect(entry, `missing key ${key}`).toBeDefined()
    expect(typeof entry.en).toBe("string")
    expect(entry.en.length).toBeGreaterThan(0)
    expect(typeof entry.sw).toBe("string")
    expect(entry.sw.length).toBeGreaterThan(0)
  })
})