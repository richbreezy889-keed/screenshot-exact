import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useApp, type TKey } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { AuthFailure } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({ component: SignupPage });

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
    <div className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t("auth.signUp")}</h1>
      {needsConfirmation ? (
        <p role="status" className="text-sm">
          {t("auth.checkingEmail")}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="signup-name">{t("auth.fullName")}</Label>
            <Input
              id="signup-name"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signup-email">{t("auth.email")}</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signup-password">{t("auth.password")}</Label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signup-role">{t("auth.role")}</Label>
            <select
              id="signup-role"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as "brand" | "creator")}
            >
              <option value="brand">{t("auth.brand")}</option>
              <option value="creator">{t("auth.creator")}</option>
            </select>
          </div>
          {errorKey && (
            <p role="alert" className="text-sm text-destructive">
              {t(errorKey)}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? t("auth.working") : t("auth.signUp")}
          </Button>
        </form>
      )}
      <p className="text-sm">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </div>
  );
}
