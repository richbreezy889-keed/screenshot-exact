export type Niche = "food" | "fashion" | "beauty" | "comedy" | "tech";
export type Location = "Dar es Salaam" | "Arusha" | "Mwanza" | "Dodoma";

export interface Creator {
  id: string;
  name: string;
  handle: string;
  niche: Niche;
  location: Location;
  followers: { tiktok: number; instagram: number }; // 0 = not on platform
  avgViews: number;
  rating: number; // 0-5
  pastCampaigns: number;
  bio: string;
}

export const totalFollowers = (c: Creator) => c.followers.tiktok + c.followers.instagram;

export const creators: Creator[] = [
  { id: "u1", name: "Neema Mushi", handle: "@neemaglow", niche: "beauty", location: "Dar es Salaam", followers: { tiktok: 182_000, instagram: 64_000 }, avgViews: 64_000, rating: 4.8, pastCampaigns: 14, bio: "Skincare routines and honest product reviews for melanin-rich skin." },
  { id: "u2", name: "Baraka Mwakyusa", handle: "@baraka.fits", niche: "fashion", location: "Arusha", followers: { tiktok: 96_500, instagram: 41_000 }, avgViews: 41_000, rating: 4.5, pastCampaigns: 8, bio: "Street style from Arusha, thrift flips and outfit transitions." },
  { id: "u3", name: "Juma Kassim", handle: "@jumakula", niche: "food", location: "Mwanza", followers: { tiktok: 240_000, instagram: 0 }, avgViews: 88_000, rating: 4.7, pastCampaigns: 21, bio: "Tasting every chipsi mayai on Lake Victoria's shores." },
  { id: "u4", name: "Rehema Saidi", handle: "@rehemacheka", niche: "comedy", location: "Dar es Salaam", followers: { tiktok: 410_000, instagram: 120_000 }, avgViews: 150_000, rating: 4.9, pastCampaigns: 30, bio: "Daladala skits and everyday Dar life, in Swahili." },
  { id: "u5", name: "Amani Lyimo", handle: "@amanitech", niche: "tech", location: "Dodoma", followers: { tiktok: 0, instagram: 58_000 }, avgViews: 22_000, rating: 4.2, pastCampaigns: 3, bio: "Budget phones, mobile money tips and app walkthroughs." },
  { id: "u6", name: "Zawadi Mrema", handle: "@zawadistyle", niche: "fashion", location: "Dar es Salaam", followers: { tiktok: 133_000, instagram: 89_000 }, avgViews: 51_000, rating: 4.6, pastCampaigns: 11, bio: "Kitenge styling and modern African looks." },
  { id: "u7", name: "Faraji Mollel", handle: "@farajicooks", niche: "food", location: "Arusha", followers: { tiktok: 45_000, instagram: 22_000 }, avgViews: 18_000, rating: 4.0, pastCampaigns: 2, bio: "Quick home recipes with local ingredients." },
  { id: "u8", name: "Imani Swai", handle: "@imanibeauty", niche: "beauty", location: "Mwanza", followers: { tiktok: 72_000, instagram: 30_000 }, avgViews: 27_000, rating: 4.4, pastCampaigns: 6, bio: "Natural hair care and affordable makeup." },
  { id: "u9", name: "Hassani Mbwana", handle: "@hassanicomedy", niche: "comedy", location: "Dodoma", followers: { tiktok: 15_000, instagram: 4_000 }, avgViews: 6_000, rating: 3.8, pastCampaigns: 1, bio: "Up-and-coming sketch comedian from the capital." },
];
