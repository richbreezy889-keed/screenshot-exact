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
  creatorsNeeded: { en: "Number of creators needed", sw: "Idadi ya watayarishi wanaohitajika" },
  eachCanEarn: { en: "Each creator can earn up to", sw: "Kila mtayarishi anaweza kupata hadi" },
  viewsPerCreator1: { en: "That is up to", sw: "Hiyo ni hadi" },
  viewsPerCreator2: { en: "views per creator at your rate.", sw: "mitazamo kwa kila mtayarishi kwa bei yako." },
  minRateMsg: { en: "The minimum rate is", sw: "Bei ya chini ni" },
  minRateMsg2: { en: "per 1,000 views. Please raise it to continue.", sw: "kwa mitazamo 1,000. Tafadhali iongeze ili kuendelea." },
  minOne: { en: "At least 1 creator is needed.", sw: "Angalau mtayarishi 1 anahitajika." },
  feeNote: { en: "Biboh keeps 15% of each creator payout. Creators see their earnings after the fee.", sw: "Biboh inachukua 15% ya malipo ya kila mtayarishi. Watayarishi wanaona mapato yao baada ya ada." },
  escrowFull: { en: "Funds are held in escrow. Unused budget, including the share of any creator slot that is never filled, returns to you when the campaign ends.", sw: "Fedha zinashikiliwa kwenye escrow. Bajeti isiyotumika, ikiwemo sehemu ya nafasi yoyote ya mtayarishi isiyojazwa, inarudi kwako kampeni ikiisha." },
  approvedOf: { en: "creators approved of", sw: "watayarishi wameidhinishwa kati ya" },
  needed: { en: "needed", sw: "wanaohitajika" },
  tabApplicants: { en: "Applicants", sw: "Waombaji" },
  tabContent: { en: "Content", sw: "Maudhui" },
  tabResults: { en: "Results", sw: "Matokeo" },
  tabPayments: { en: "Payments", sw: "Malipo" },
  approve: { en: "Approve", sw: "Idhinisha" },
  decline: { en: "Decline", sw: "Kataa" },
  approved: { en: "Approved", sw: "Imeidhinishwa" },
  declined: { en: "Declined", sw: "Imekataliwa" },
  slotsFull: { en: "All creator slots are filled.", sw: "Nafasi zote za watayarishi zimejaa." },
  rating: { en: "Rating", sw: "Ukadiriaji" },
  pastCampaigns: { en: "past campaigns", sw: "kampeni zilizopita" },
  awaiting: { en: "Awaiting review", sw: "Inasubiri ukaguzi" },
  revision: { en: "Revision requested", sw: "Marekebisho yameombwa" },
  requestRevision: { en: "Request revision", sw: "Omba marekebisho" },
  revisionComment: { en: "What should the creator change?", sw: "Mtayarishi abadilishe nini?" },
  send: { en: "Send", sw: "Tuma" },
  cancel: { en: "Cancel", sw: "Ghairi" },
  submitted: { en: "Submitted", sw: "Imetumwa" },
  emptyApplicants: { en: "No applicants yet.", sw: "Bado hakuna waombaji." },
  emptyContent: { en: "No videos submitted yet.", sw: "Bado hakuna video zilizotumwa." },
  emptyResults: { en: "No verified results yet.", sw: "Bado hakuna matokeo yaliyothibitishwa." },
  creator: { en: "Creator", sw: "Mtayarishi" },
  post: { en: "Post", sw: "Chapisho" },
  checkpointViews: { en: "Verified views (checkpoint)", sw: "Mitazamo iliyothibitishwa (kituo)" },
  earningsBeforeFee: { en: "Earnings before fee", sw: "Mapato kabla ya ada" },
  shareCap: { en: "Share cap", sw: "Kikomo cha sehemu" },
  total: { en: "Total", sw: "Jumla" },
  viewsOverTime: { en: "Views over time", sw: "Mitazamo kwa muda" },
  ledger: { en: "Escrow ledger", sw: "Daftari la escrow" },
  funded: { en: "Funded", sw: "Imelipiwa" },
  paidOut: { en: "Paid out to creators", sw: "Imelipwa kwa watayarishi" },
  fee: { en: "Platform fee", sw: "Ada ya jukwaa" },
  returned: { en: "Returned to you", sw: "Imerudishwa kwako" },
  date: { en: "Date", sw: "Tarehe" },
  amount: { en: "Amount", sw: "Kiasi" },
  notFound: { en: "Campaign not found.", sw: "Kampeni haikupatikana." },
  searchName: { en: "Search by name", sw: "Tafuta kwa jina" },
  anyNiche: { en: "All niches", sw: "Aina zote" },
  anyPlatform: { en: "All platforms", sw: "Majukwaa yote" },
  anyLocation: { en: "All locations", sw: "Maeneo yote" },
  anyFollowers: { en: "Any followers", sw: "Wafuasi wowote" },
  anyRating: { en: "Any rating", sw: "Ukadiriaji wowote" },
  clearFilters: { en: "Clear filters", sw: "Futa vichujio" },
  about: { en: "About", sw: "Kuhusu" },
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
