import type { TKey } from "@/lib/i18n";

const nicheKeys: Record<string, TKey> = {
  food: "nicheFood",
  fashion: "nicheFashion",
  beauty: "nicheBeauty",
  comedy: "nicheComedy",
  tech: "nicheTech",
};

/** Translation key for a content niche, or null for data we don't label yet. */
export function nicheKey(niche: string): TKey | null {
  return nicheKeys[niche] ?? null;
}
