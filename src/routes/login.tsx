import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useApp, type TKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { AuthFailure } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in — Biboh" },
      { name: "description", content: "Sign in to your Biboh account." },
      { property: "og:title", content: "Sign in — Biboh" },
      { property: "og:description", content: "Sign in to your Biboh account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

export function LoginPage() {
  const { t } = useApp();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<TKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorKey(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
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
        <h1 className="mb-6 text-center font-display text-2xl font-bold">{t("auth.signIn")}</h1>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="login-email">{t("auth.email")}</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              className="h-12 rounded-xl bg-background text-base md:text-base"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">{t("auth.password")}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12 rounded-xl bg-background text-base md:text-base"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
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
            {submitting ? t("auth.working") : t("auth.signIn")}
          </Button>
        </form>
        <p className="mt-6 border-t border-border pt-6 text-center text-sm leading-relaxed text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link
            to="/signup"
            className="rounded-sm font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("auth.signUp")}
          </Link>
        </p>
      </div>
    </div>
  );
}
