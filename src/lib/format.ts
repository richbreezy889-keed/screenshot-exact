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
