import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => {
  const state = {
    supabase: false,
    path: "/",
    authCb: null as null | ((event: string, session: unknown) => void),
  }
  const unsubscribe = vi.fn()
  const signOut = vi.fn(async () => ({ error: null }))
  const fake = {
    auth: {
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        state.authCb = cb
        return { data: { subscription: { unsubscribe } } }
      }),
      signOut,
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { role: "brand" }, error: null }) }),
      }),
    }),
  }
  return { state, unsubscribe, signOut, fake }
})

vi.mock("@/lib/supabase", () => ({
  isSupabaseMode: () => h.state.supabase,
  getSupabase: () => h.fake,
}))

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>()
  return {
    ...actual,
    useLocation: ({ select }: { select: (l: { pathname: string }) => unknown }) =>
      select({ pathname: h.state.path }),
    Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  }
})

import { AuthGuard, AuthProvider, useAuth } from "@/lib/auth"

const session = { user: { id: "u1", email: "a@b.co" } }

function Probe() {
  const { user, role, signOut } = useAuth()
  return (
    <div>
      <span data-testid="who">{user?.email ?? "none"}</span>
      <span data-testid="role">{role ?? "none"}</span>
      <button onClick={() => void signOut()}>out</button>
    </div>
  )
}

function setup() {
  return render(
    <AuthProvider>
      <AuthGuard>
        <Probe />
      </AuthGuard>
    </AuthProvider>,
  )
}

function emit(event: string, sess: unknown) {
  act(() => {
    h.state.authCb?.(event, sess)
  })
}

beforeEach(() => {
  h.state.supabase = false
  h.state.path = "/"
  h.state.authCb = null
  h.unsubscribe.mockClear()
  h.signOut.mockClear()
})
afterEach(cleanup)

describe("AuthGuard", () => {
  it("does nothing in mock mode", () => {
    setup()
    expect(screen.getByTestId("who").textContent).toBe("none")
    expect(screen.queryByTestId("redirect")).toBeNull()
    expect(h.fake.auth.onAuthStateChange).not.toHaveBeenCalled()
  })

  it("renders nothing and does not redirect while loading", () => {
    h.state.supabase = true
    setup()
    expect(screen.queryByTestId("who")).toBeNull()
    expect(screen.queryByTestId("redirect")).toBeNull()
  })

  it("redirects a signed-out visitor to /login", () => {
    h.state.supabase = true
    setup()
    emit("INITIAL_SESSION", null)
    expect(screen.getByTestId("redirect").textContent).toBe("/login")
    expect(screen.queryByTestId("who")).toBeNull()
  })

  it("shows the app to a signed-in user and loads the role from profiles", async () => {
    h.state.supabase = true
    setup()
    emit("INITIAL_SESSION", session)
    expect(screen.getByTestId("who").textContent).toBe("a@b.co")
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("brand"))
  })

  it("sends a signed-in user away from /login to /", () => {
    h.state.supabase = true
    h.state.path = "/login"
    setup()
    emit("INITIAL_SESSION", session)
    expect(screen.getByTestId("redirect").textContent).toBe("/")
  })

  it("lets a signed-out visitor see /login and /signup", () => {
    h.state.supabase = true
    h.state.path = "/signup"
    setup()
    emit("INITIAL_SESSION", null)
    expect(screen.queryByTestId("redirect")).toBeNull()
    expect(screen.getByTestId("who").textContent).toBe("none")
  })
})

describe("AuthProvider", () => {
  it("signOut calls Supabase and clears the session", async () => {
    h.state.supabase = true
    setup()
    emit("INITIAL_SESSION", session)
    await waitFor(() => expect(screen.getByTestId("role").textContent).toBe("brand"))
    fireEvent.click(screen.getByText("out"))
    await waitFor(() => expect(screen.getByTestId("redirect").textContent).toBe("/login"))
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it("unsubscribes from auth changes on unmount", () => {
    h.state.supabase = true
    const view = setup()
    view.unmount()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })
})