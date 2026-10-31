export type CampaignStatus = "draft" | "live" | "completed";
export type Platform = "TikTok" | "Instagram";

export interface Campaign {
  id: string;
  title: string;
  brand: string;
  status: CampaignStatus;
  platforms: Platform[];
  niche: string;
  ratePer1k: number; // TZS
  budget: number; // TZS
  spent: number; // TZS
  creatorsApproved: number;
  creatorsNeeded: number;
  deadline: string; // ISO date
  views: number;
}

export const campaigns: Campaign[] = [
  {
    id: "c1",
    title: "Zuri Glow Serum Launch",
    brand: "Zuri Beauty",
    status: "live",
    platforms: ["TikTok", "Instagram"],
    niche: "beauty",
    ratePer1k: 4500,
    budget: 5_000_000,
    spent: 813_600,
    creatorsApproved: 8,
    creatorsNeeded: 10,
    deadline: "2026-11-15",
    views: 180_800,
  },
  {
    id: "c2",
    title: "Kilele Morning Ritual",
    brand: "Kilele Coffee",
    status: "live",
    platforms: ["Instagram"],
    niche: "food",
    ratePer1k: 3800,
    budget: 3_000_000,
    spent: 532_000,
    creatorsApproved: 5,
    creatorsNeeded: 6,
    deadline: "2026-11-30",
    views: 140_000,
  },
  {
    id: "c3",
    title: "Mtaani Wear Street Drop",
    brand: "Mtaani Wear",
    status: "live",
    platforms: ["TikTok"],
    niche: "fashion",
    ratePer1k: 5000,
    budget: 4_500_000,
    spent: 663_000,
    creatorsApproved: 12,
    creatorsNeeded: 12,
    deadline: "2026-10-31",
    views: 132_600,
  },
  {
    id: "c4",
    title: "Dar Bites Weekend Combo",
    brand: "Dar Bites",
    status: "completed",
    platforms: ["TikTok", "Instagram"],
    niche: "food",
    ratePer1k: 3500,
    budget: 2_000_000,
    spent: 749_464,
    creatorsApproved: 7,
    creatorsNeeded: 7,
    deadline: "2026-09-30",
    views: 227_500,
  },
  {
    id: "c5",
    title: "Zuri Holiday Gift Sets",
    brand: "Zuri Beauty",
    status: "draft",
    platforms: ["Instagram"],
    niche: "beauty",
    ratePer1k: 4200,
    budget: 6_000_000,
    spent: 0,
    creatorsApproved: 0,
    creatorsNeeded: 15,
    deadline: "2026-12-20",
    views: 0,
  },
  {
    id: "c6",
    title: "Kilele Cold Brew Comedy",
    brand: "Kilele Coffee",
    status: "completed",
    platforms: ["TikTok"],
    niche: "comedy",
    ratePer1k: 3000,
    budget: 1_500_000,
    spent: 645_000,
    creatorsApproved: 4,
    creatorsNeeded: 4,
    deadline: "2026-08-25",
    views: 225_000,
  },
];
