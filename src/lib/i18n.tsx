import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "sw";

const dict = {
  dashboard: { en: "Dashboard", sw: "Dashibodi" },
  campaigns: { en: "Campaigns", sw: "Kampeni" },
  creators: { en: "Creators", sw: "Watayarishi" },
  wallet: { en: "Wallet", sw: "Pochi" },
  settings: { en: "Settings", sw: "Mipangilio" },
  search: { en: "Search campaigns, creators…", sw: "Tafuta kampeni, watayarishi…" },
  greeting: { en: "Habari, Zuri Beauty", sw: "Habari, Zuri Beauty" },
  greetingSub: { en: "Here's how your campaigns are performing.", sw: "Hivi ndivyo kampeni zako zinavyofanya." },
  createCampaign: { en: "Create campaign", sw: "Unda kampeni" },
  totalSpend: { en: "Total spend", sw: "Jumla ya matumizi" },
  verifiedViews: { en: "Verified views", sw: "Mitazamo iliyothibitishwa" },
  activeCampaigns: { en: "Active campaigns", sw: "Kampeni hai" },
  avgCpm: { en: "Avg. cost per 1,000 views", sw: "Wastani wa gharama kwa mitazamo 1,000" },
  last30: { en: "Views and spend, last 30 days", sw: "Mitazamo na matumizi, siku 30 zilizopita" },
  views: { en: "Views", sw: "Mitazamo" },
  spend: { en: "Spend", sw: "Matumizi" },
  attention: { en: "Needs your attention", sw: "Inahitaji umakini wako" },
  approveVideo: { en: "videos to approve", sw: "video za kuidhinisha" },
  verifyViews: { en: "views to verify", sw: "mitazamo ya kuthibitisha" },
  applicants: { en: "applicants waiting", sw: "waombaji wanasubiri" },
  review: { en: "Review", sw: "Kagua" },
  budgetUsed: { en: "used", sw: "imetumika" },
  budgetLeft: { en: "left", sw: "imebaki" },
  all: { en: "All", sw: "Zote" },
  draft: { en: "Draft", sw: "Rasimu" },
  live: { en: "Live", sw: "Hai" },
  completed: { en: "Completed", sw: "Imekamilika" },
  ratePer1k: { en: "Rate / 1K views", sw: "Bei / mitazamo 1K" },
  budgetRemaining: { en: "Budget remaining", sw: "Bajeti iliyobaki" },
  creatorsApproved: { en: "Creators approved", sw: "Watayarishi walioidhinishwa" },
  deadline: { en: "Deadline", sw: "Tarehe ya mwisho" },
  emptyCampaigns: { en: "No campaigns here yet.", sw: "Bado hakuna kampeni hapa." },
  emptyAttention: { en: "You're all caught up.", sw: "Kila kitu kiko sawa." },
  emptyCreators: { en: "No creators found.", sw: "Hakuna watayarishi." },
  error: { en: "Something went wrong loading this.", sw: "Hitilafu imetokea wakati wa kupakia." },
  retry: { en: "Try again", sw: "Jaribu tena" },
  stepBrief: { en: "Brief", sw: "Maelezo" },
  stepBudget: { en: "Budget", sw: "Bajeti" },
  stepReq: { en: "Requirements", sw: "Mahitaji" },
  stepReview: { en: "Review & fund", sw: "Kagua na lipia" },
  title: { en: "Campaign title", sw: "Jina la kampeni" },
  description: { en: "Description", sw: "Maelezo" },
  platforms: { en: "Platforms", sw: "Majukwaa" },
  niche: { en: "Content niche", sw: "Aina ya maudhui" },
  dos: { en: "Do's (one per line)", sw: "Fanya (moja kwa mstari)" },
  donts: { en: "Don'ts (one per line)", sw: "Usifanye (moja kwa mstari)" },
  totalBudget: { en: "Total budget (TZS)", sw: "Bajeti jumla (TZS)" },
  rateInput: { en: "Rate per 1,000 views (TZS)", sw: "Bei kwa mitazamo 1,000 (TZS)" },
  estimate: { en: "This budget buys about", sw: "Bajeti hii inanunua takriban" },
  verifiedViewsLower: { en: "verified views", sw: "mitazamo iliyothibitishwa" },
  videoLength: { en: "Video length", sw: "Urefu wa video" },
  numCreators: { en: "Number of creators", sw: "Idadi ya watayarishi" },
  location: { en: "Creator location", sw: "Mahali pa mtayarishi" },
  minFollowers: { en: "Minimum followers", sw: "Wafuasi wa chini" },
  paymentMethod: { en: "Payment method", sw: "Njia ya malipo" },
  escrow: { en: "Funds are held in escrow and any unspent budget returns to you.", sw: "Fedha zinashikiliwa kwenye escrow na bajeti isiyotumika inarudi kwako." },
  back: { en: "Back", sw: "Rudi" },
  next: { en: "Next", sw: "Endelea" },
  fund: { en: "Fund campaign", sw: "Lipia kampeni" },
  funding: { en: "Processing…", sw: "Inashughulikiwa…" },
  successTitle: { en: "Campaign funded!", sw: "Kampeni imelipiwa!" },
  successBody: { en: "Creators can now apply. We'll notify you as videos come in.", sw: "Watayarishi sasa wanaweza kuomba. Tutakujulisha video zikifika." },
  viewCampaigns: { en: "View campaigns", sw: "Tazama kampeni" },
  required: { en: "Required", sw: "Inahitajika" },
  followers: { en: "followers", sw: "wafuasi" },
  avgViews: { en: "avg. views", sw: "wastani wa mitazamo" },
  balance: { en: "Escrow balance", sw: "Salio la escrow" },
  comingSoon: { en: "This section is coming soon.", sw: "Sehemu hii inakuja hivi karibuni." },
  notifications: { en: "Notifications", sw: "Arifa" },
  toggleTheme: { en: "Toggle theme", sw: "Badilisha mandhari" },
} as const;

export type TKey = keyof typeof dict;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
  theme: "dark" | "light";
  toggleTheme: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.lang = lang;
  }, [theme, lang]);
  return (
    <AppCtx.Provider
      value={{
        lang,
        setLang,
        t: (k) => dict[k][lang],
        theme,
        toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
