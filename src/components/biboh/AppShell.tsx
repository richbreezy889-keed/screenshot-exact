import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  LayoutDashboard,
  Megaphone,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { useApp, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const nav: {
  to: "/" | "/campaigns" | "/creators" | "/wallet" | "/settings";
  key: TKey;
  icon: typeof LayoutDashboard;
}[] = [
  { to: "/", key: "dashboard", icon: LayoutDashboard },
  { to: "/campaigns", key: "campaigns", icon: Megaphone },
  { to: "/creators", key: "creators", icon: Users },
  { to: "/wallet", key: "wallet", icon: Wallet },
  { to: "/settings", key: "settings", icon: Settings },
];

const linkBase =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang, theme, toggleTheme } = useApp();
  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-brand font-display font-bold text-primary-foreground">
            B
          </span>
          <span className="font-display text-xl font-bold">Biboh</span>
        </Link>
        <nav className="space-y-1" aria-label="Main">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className={cn(
                linkBase,
                "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
              activeProps={{ className: "!bg-primary !text-primary-foreground shadow-glow" }}
            >
              <n.icon className="h-4 w-4" aria-hidden />
              {t(n.key)}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-8">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-brand font-display font-bold text-primary-foreground md:hidden">
            B
          </span>
          <IconBtn label={t("search")} className="min-[480px]:hidden">
            <Search className="h-4 w-4" aria-hidden />
          </IconBtn>
          <label className="relative hidden min-[480px]:block flex-1 md:max-w-md">
            <span className="sr-only">{t("search")}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              placeholder={t("search")}
              className="h-10 w-full rounded-xl border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <div
              className="flex rounded-xl border bg-card p-0.5 text-xs font-semibold"
              role="group"
              aria-label="Language"
            >
              {(["en", "sw"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <IconBtn label={t("toggleTheme")} onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </IconBtn>
            <IconBtn label={t("notifications")}>
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent" aria-hidden />
            </IconBtn>
            <span
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
              aria-label="Zuri Beauty"
            >
              ZB
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-sidebar/95 backdrop-blur md:hidden"
        aria-label="Main"
      >
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            activeProps={{ className: "!text-primary" }}
          >
            <n.icon className="h-5 w-5" aria-hidden />
            {t(n.key)}
          </Link>
        ))}
      </nav>
      <Toaster theme={theme} position="top-right" />
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-xl border bg-card text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}
