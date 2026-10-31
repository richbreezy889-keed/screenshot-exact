export function formatTZS(n: number) {
  return `TZS ${Math.round(n).toLocaleString("en-US")}`;
}

export function formatViews(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function formatDate(iso: string, lang: "en" | "sw") {
  return new Date(iso).toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SHORT_MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  sw: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"],
} as const;

/** Short day + month for chart axes, e.g. "23 Sep" / "23 Okt". */
export function formatDayMonth(iso: string, lang: "en" | "sw") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${SHORT_MONTHS[lang][date.getUTCMonth()]}`;
}

/** Human platform name for a post URL, falling back to the bare host. */
export function postPlatform(url: string) {
  try {
    const host = new URL(url).host.replace(/^www\./, "").toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "TikTok";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "Instagram";
    return host;
  } catch {
    return url;
  }
}
