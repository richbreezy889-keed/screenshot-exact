import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useApp, type TKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { AuthFailure } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({
    meta: [
      { title: "Sign up — Biboh" },
      { name: "description", content: "Create your Biboh brand or creator account." },
      { property: "og:title", content: "Sign up — Biboh" },
      { property: "og:description", content: "Create your Biboh brand or creator account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

export function SignupPage() {
  const { t } = useApp();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"brand" | "creator">("brand");
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorKey(null);
    setSubmitting(true);
    try {
      const result = await signUp(email, password, fullName, role);
      if (result.kind === "needs-confirmation") {
        setNeedsConfirmation(true);
      }
    } catch (err) {
      if (err instanceof AuthFailure) {
        setErrorKey(err.key);
      } else {
        setErrorKey("auth.unknown");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 font-sans text-foreground sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-soft sm:p-8">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand font-display text-xl font-bold text-primary-foreground"
          >
            B
          </span>
          <span className="font-display text-3xl font-bold">Biboh</span>
        </div>
        <h1 className="mb-6 text-center font-display text-2xl font-bold">{t("auth.signUp")}</h1>
        {needsConfirmation ? (
          <p
            role="status"
            className="rounded-xl border border-success/30 bg-success/10 px-4 py-4 text-center text-sm leading-relaxed text-foreground"
          >
            {t("auth.checkingEmail")}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="signup-name">{t("auth.fullName")}</Label>
              <Input
                id="signup-name"
                type="text"
                autoComplete="name"
                required
                className="h-12 rounded-xl bg-background text-base md:text-base"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">{t("auth.email")}</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                className="h-12 rounded-xl bg-background text-base md:text-base"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">{t("auth.password")}</Label>
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="h-12 rounded-xl bg-background text-base md:text-base"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-role">{t("auth.role")}</Label>
              <select
                id="signup-role"
                className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
                value={role}
                onChange={(e) => setRole(e.target.value as "brand" | "creator")}
              >
                <option value="brand">{t("auth.brand")}</option>
                <option value="creator">{t("auth.creator")}</option>
              </select>
            </div>
            {errorKey && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-relaxed text-foreground"
              >
                {t(errorKey)}
              </p>
            )}
            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full rounded-xl text-base font-semibold shadow-glow"
            >
              {submitting ? t("auth.working") : t("auth.signUp")}
            </Button>
          </form>
        )}
        <p className="mt-6 border-t border-border pt-6 text-center text-sm leading-relaxed text-muted-foreground">
          {t("auth.haveAccount")}{" "}
          <Link
            to="/login"
            className="rounded-sm font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("auth.signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
