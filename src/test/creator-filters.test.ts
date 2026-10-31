import { describe, expect, it } from "vitest";
import { creators, type Creator } from "@/data/creators";
import {
  defaultCreatorFilters,
  filterCreators,
  hasActiveFilters,
  type CreatorFilters,
} from "@/lib/creatorFilters";

const base: Creator = {
  id: "test",
  name: "Test Creator",
  handle: "@testcreator",
  niche: "food",
  location: "Dar es Salaam",
  followers: { tiktok: 0, instagram: 0 },
  avgViews: 1_000,
  rating: 4,
  pastCampaigns: 1,
  bio: "Test bio.",
};

const make = (overrides: Partial<Creator> = {}): Creator => ({ ...base, ...overrides });

const run = (overrides: Partial<CreatorFilters> = {}, list: Creator[] = creators) =>
  filterCreators(list, { ...defaultCreatorFilters, ...overrides });

const ids = (list: Creator[]) => list.map((creator) => creator.id);

describe("filterCreators", () => {
  it("returns every creator, in order, with the default filters", () => {
    expect(ids(run())).toEqual(ids(creators));
    expect(creators).toHaveLength(32);
  });

  it("searches names case-insensitively", () => {
    expect(ids(run({ query: "NEEMA" }))).toEqual(["u1", "u15"]);
    expect(ids(run({ query: "  neema  " }))).toEqual(["u1", "u15"]);
  });

  it("searches handles with or without the @ prefix", () => {
    expect(ids(run({ query: "@zawadi" }))).toEqual(["u6"]);
    expect(ids(run({ query: "zawadi" }))).toEqual(["u6"]);
  });

  it("filters by niche", () => {
    const result = run({ niche: "beauty" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((creator) => creator.niche === "beauty")).toBe(true);
    expect(ids(result)).toContain("u1");
    expect(ids(result)).not.toContain("u2");
  });

  it("filters by platform presence", () => {
    const tiktok = run({ platform: "tiktok" });
    expect(tiktok.every((creator) => creator.followers.tiktok > 0)).toBe(true);
    expect(ids(tiktok)).toContain("u3");
    expect(ids(tiktok)).not.toContain("u5");

    const instagram = run({ platform: "instagram" });
    expect(instagram.every((creator) => creator.followers.instagram > 0)).toBe(true);
    expect(ids(instagram)).toContain("u5");
    expect(ids(instagram)).not.toContain("u3");
  });

  it("filters by location", () => {
    const result = run({ location: "Arusha" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((creator) => creator.location === "Arusha")).toBe(true);
    expect(ids(result)).toContain("u2");
  });

  it("splits follower ranges at the boundaries", () => {
    const sample = [49_999, 50_000, 99_999, 100_000, 249_999, 250_000].map((total, i) =>
      make({ id: `s${i}`, followers: { tiktok: total, instagram: 0 } }),
    );

    expect(ids(run({ followers: "under50k" }, sample))).toEqual(["s0"]);
    expect(ids(run({ followers: "50k-100k" }, sample))).toEqual(["s1", "s2"]);
    expect(ids(run({ followers: "100k-250k" }, sample))).toEqual(["s3", "s4"]);
    expect(ids(run({ followers: "250k-plus" }, sample))).toEqual(["s5"]);
    expect(ids(run({ followers: "any" }, sample))).toEqual(ids(sample));
  });

  it("counts followers across both platforms", () => {
    const sample = [
      make({ id: "both", followers: { tiktok: 30_000, instagram: 30_000 } }),
      make({ id: "one", followers: { tiktok: 30_000, instagram: 0 } }),
    ];
    expect(ids(run({ followers: "50k-100k" }, sample))).toEqual(["both"]);
    expect(ids(run({ followers: "under50k" }, sample))).toEqual(["one"]);
  });

  it("filters by minimum rating, including creators exactly on it", () => {
    const sample = [3.9, 4, 4.5, 4.8].map((rating, i) => make({ id: `r${i}`, rating }));
    expect(ids(run({ minRating: 4.5 }, sample))).toEqual(["r2", "r3"]);
    expect(ids(run({ minRating: 0 }, sample))).toEqual(ids(sample));
  });

  it("combines search and every filter", () => {
    expect(
      ids(
        run({
          query: "neema",
          niche: "beauty",
          platform: "tiktok",
          location: "Dar es Salaam",
          followers: "100k-250k",
          minRating: 4.5,
        }),
      ),
    ).toEqual(["u1"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(run({ query: "nobody" })).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults, including whitespace-only searches", () => {
    expect(hasActiveFilters(defaultCreatorFilters)).toBe(false);
    expect(hasActiveFilters({ ...defaultCreatorFilters, query: "   " })).toBe(false);
  });

  it.each<Partial<CreatorFilters>>([
    { query: "neema" },
    { niche: "beauty" },
    { platform: "tiktok" },
    { location: "Arusha" },
    { followers: "100k-250k" },
    { minRating: 4.5 },
  ])("is true when %o changes", (change) => {
    expect(hasActiveFilters({ ...defaultCreatorFilters, ...change })).toBe(true);
  });
});
