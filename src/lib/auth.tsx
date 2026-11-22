import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { Navigate, useLocation } from "@tanstack/react-router"
import type { Session, User } from "@supabase/supabase-js"
import { getSupabase, isSupabaseMode } from "./supabase"
import {
  AuthFailure,
  fetchRoleWith,
  signInWith,
  signUpWith,
  type ProfileRole,
  type SignUpResult,
  type SignUpRole,
} from "./auth-api"

interface AuthContextValue {
  session: Session | null
  user: User | null
  role: ProfileRole | null
  loading: boolean
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: SignUpRole,
  ) => Promise<SignUpResult>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const c = useContext(AuthCtx)
  if (!c) throw new Error("useAuth outside AuthProvider")
  return c
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<ProfileRole | null>(null)
  // Mock mode never loads anything, so it must never be "loading".
  const [loading, setLoading] = useState(isSupabaseMode())

  useEffect(() => {
    if (!isSupabaseMode()) return
    let active = true
    const sb = getSupabase()

    // The callback must not await other supabase calls (can deadlock the
    // client), so the role lookup is deferred with setTimeout.
    const { data } = sb.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setLoading(false)
      if (sess?.user) {
        const uid = sess.user.id
        setTimeout(() => {
          fetchRoleWith(sb, uid)
            .then((r) => {
              if (active) setRole(r)
            })
            .catch(() => {
              if (active) setRole(null)
            })
        }, 0)
      } else {
        setRole(null)
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    signUpRole: SignUpRole,
  ) {
    if (!isSupabaseMode()) throw new AuthFailure("auth.supabaseNotConfigured")
    return signUpWith(getSupabase(), email, password, fullName, signUpRole)
  }

  async function signIn(email: string, password: string) {
    if (!isSupabaseMode()) throw new AuthFailure("auth.supabaseNotConfigured")
    await signInWith(getSupabase(), email, password)
  }

  async function signOut() {
    if (isSupabaseMode()) await getSupabase().auth.signOut()
    setSession(null)
    setRole(null)
  }

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    role,
    loading,
    signUp,
    signIn,
    signOut,
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

const PUBLIC_PATHS = ["/login", "/signup"]

/**
 * Client-side guard, wrapped once around the root outlet.
 * - Mock mode: always renders children.
 * - Loading: renders nothing (no flash of the app).
 * - Signed out on a private page: redirect to /login.
 * - Signed in on /login or /signup: redirect to /.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const pathname = useLocation({ select: (l) => l.pathname })

  if (!isSupabaseMode()) return <>{children}</>
  if (loading) return null

  const isPublic = PUBLIC_PATHS.includes(pathname)
  if (isPublic && session) return <Navigate to="/" replace />
  if (!isPublic && !session) return <Navigate to="/login" replace />
  return <>{children}</>
}