export interface Creator {
  id: string;
  name: string;
  handle: string;
  niche: "food" | "fashion" | "beauty" | "comedy" | "tech";
  location: "Dar es Salaam" | "Arusha" | "Mwanza" | "Dodoma";
  followers: number;
  avgViews: number;
}

export const creators: Creator[] = [
  { id: "u1", name: "Neema Mushi", handle: "@neemaglow", niche: "beauty", location: "Dar es Salaam", followers: 182_000, avgViews: 64_000 },
  { id: "u2", name: "Baraka Mwakyusa", handle: "@baraka.fits", niche: "fashion", location: "Arusha", followers: 96_500, avgViews: 41_000 },
  { id: "u3", name: "Juma Kassim", handle: "@jumakula", niche: "food", location: "Mwanza", followers: 240_000, avgViews: 88_000 },
  { id: "u4", name: "Rehema Saidi", handle: "@rehemacheka", niche: "comedy", location: "Dar es Salaam", followers: 410_000, avgViews: 150_000 },
  { id: "u5", name: "Amani Lyimo", handle: "@amanitech", niche: "tech", location: "Dodoma", followers: 58_000, avgViews: 22_000 },
  { id: "u6", name: "Zawadi Mrema", handle: "@zawadistyle", niche: "fashion", location: "Dar es Salaam", followers: 133_000, avgViews: 51_000 },
];
