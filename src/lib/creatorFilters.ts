import { totalFollowers, type Creator, type Location, type Niche } from "@/data/creators";

export type CreatorPlatform = "tiktok" | "instagram";

export const FOLLOWER_RANGES = ["any", "under50k", "50k-100k", "100k-250k", "250k-plus"] as const;
export type FollowerRange = (typeof FOLLOWER_RANGES)[number];

export interface CreatorFilters {
  query: string;
  niche: Niche | "all";
  platform: CreatorPlatform | "all";
  location: Location | "all";
  followers: FollowerRange;
  minRating: number;
}

export const defaultCreatorFilters: CreatorFilters = {
  query: "",
  niche: "all",
  platform: "all",
  location: "all",
  followers: "any",
  minRating: 0,
};

function withinFollowerRange(count: number, range: FollowerRange) {
  if (range === "under50k") return count < 50_000;
  if (range === "50k-100k") return count >= 50_000 && count < 100_000;
  if (range === "100k-250k") return count >= 100_000 && count < 250_000;
  if (range === "250k-plus") return count >= 250_000;
  return true;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/^@/, "");

/** Apply the creators page filters to a list, preserving the input order. */
export function filterCreators(list: Creator[], filters: CreatorFilters): Creator[] {
  const query = normalize(filters.query);

  return list.filter((creator) => {
    if (query) {
      const name = creator.name.toLowerCase();
      const handle = normalize(creator.handle);
      if (!name.includes(query) && !handle.includes(query)) return false;
    }
    if (filters.niche !== "all" && creator.niche !== filters.niche) return false;
    if (filters.platform !== "all" && creator.followers[filters.platform] <= 0) return false;
    if (filters.location !== "all" && creator.location !== filters.location) return false;
    if (!withinFollowerRange(totalFollowers(creator), filters.followers)) return false;
    if (filters.minRating > 0 && creator.rating < filters.minRating) return false;
    return true;
  });
}

export function hasActiveFilters(filters: CreatorFilters) {
  return (
    filters.query.trim() !== "" ||
    filters.niche !== "all" ||
    filters.platform !== "all" ||
    filters.location !== "all" ||
    filters.followers !== "any" ||
    filters.minRating > 0
  );
}
