import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "sw";

export const LANG_COOKIE = "biboh-lang";

// eslint-disable-next-line react-refresh/only-export-components
export const dict = {
  dashboard: { en: "Dashboard", sw: "Dashibodi" },
  campaigns: { en: "Campaigns", sw: "Kampeni" },
  creators: { en: "Creators", sw: "Watayarishi" },
  creatorsSub: {
    en: "Browse and filter Tanzanian creators for your campaigns.",
    sw: "Vinjari na uchuje watayarishi wa Tanzania kwa kampeni zako.",
  },
  wallet: { en: "Wallet", sw: "Pochi" },
  settings: { en: "Settings", sw: "Mipangilio" },
  search: { en: "Search campaigns, creators…", sw: "Tafuta kampeni, watayarishi…" },
  greeting: { en: "Habari, Zuri Beauty", sw: "Habari, Zuri Beauty" },
  greetingSub: {
    en: "Here's how your campaigns are performing.",
    sw: "Hivi ndivyo kampeni zako zinavyofanya.",
  },
  createCampaign: { en: "Create campaign", sw: "Unda kampeni" },
  totalSpend: { en: "Total spend", sw: "Jumla ya matumizi" },
  verifiedViews: { en: "Verified views", sw: "Mitazamo iliyothibitishwa" },
  estimatedViews: { en: "Estimated views", sw: "Mitazamo inayokadiriwa" },
  activeCampaigns: { en: "Active campaigns", sw: "Kampeni hai" },
  avgCpm: { en: "Avg. cost per 1,000 views", sw: "Wastani wa gharama kwa mitazamo 1,000" },
  last30: { en: "Views and spend, last 30 days", sw: "Mitazamo na matumizi, siku 30 zilizopita" },
  views: { en: "Views", sw: "Mitazamo" },
  spend: { en: "Spend", sw: "Matumizi" },
  attention: { en: "Needs your attention", sw: "Inahitaji umakini wako" },
  approveVideo: { en: "videos to approve", sw: "video za kuidhinisha" },
  approveVideoOne: { en: "video to approve", sw: "video ya kuidhinisha" },
  verifyViews: { en: "views to verify", sw: "mitazamo ya kuthibitisha" },
  verifyViewsOne: { en: "view to verify", sw: "mtazamo wa kuthibitisha" },
  applicants: { en: "applicants waiting", sw: "waombaji wanasubiri" },
  applicantsOne: { en: "applicant waiting", sw: "mwombaji anasubiri" },
  review: { en: "Review", sw: "Kagua" },
  budgetUsed: { en: "used", sw: "imetumika" },
  budgetSpent: { en: "spent", sw: "imetumika" },
  budgetReserved: {
    en: "reserved for views still counting",
    sw: "imehifadhiwa kwa mitazamo inayohesabiwa",
  },
  budgetLeftToReturn: { en: "left to return", sw: "iliyobaki kurudishwa" },
  budgetLeft: { en: "left", sw: "imebaki" },
  budget: { en: "Budget", sw: "Bajeti" },
  notFunded: { en: "Not funded", sw: "Haijalipiwa" },
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
  progressLabel: { en: "Progress", sw: "Maendeleo" },
  title: { en: "Campaign title", sw: "Jina la kampeni" },
  titlePlaceholder: { en: "Zuri Glow Serum Launch", sw: "Uzinduzi wa Zuri Glow Serum" },
  description: { en: "Description", sw: "Maelezo" },
  descriptionPlaceholder: {
    en: "Show your morning skincare routine using the new serum.",
    sw: "Onyesha utaratibu wako wa asubuhi wa kutunza ngozi ukitumia serum mpya.",
  },
  platforms: { en: "Platforms", sw: "Majukwaa" },
  niche: { en: "Content niche", sw: "Aina ya maudhui" },
  dos: { en: "Do's (one per line)", sw: "Fanya (moja kwa mstari)" },
  dosPlaceholder: {
    en: "Show the product in the first 3 seconds",
    sw: "Onyesha bidhaa katika sekunde 3 za kwanza",
  },
  donts: { en: "Don'ts (one per line)", sw: "Usifanye (moja kwa mstari)" },
  dontsPlaceholder: {
    en: "Don't mention competitor brands",
    sw: "Usitaje chapa za washindani",
  },
  totalBudget: { en: "Total budget (TZS)", sw: "Bajeti jumla (TZS)" },
  rateInput: { en: "Rate per 1,000 views (TZS)", sw: "Bei kwa mitazamo 1,000 (TZS)" },
  minRateHelpSuffix: { en: "per 1,000 views", sw: "kwa mitazamo 1,000" },
  estimate: { en: "This budget buys about", sw: "Bajeti hii inanunua takriban" },
  verifiedViewsLower: { en: "verified views", sw: "mitazamo iliyothibitishwa" },
  videoLength: { en: "Video length", sw: "Urefu wa video" },
  numCreators: { en: "Number of creators", sw: "Idadi ya watayarishi" },
  location: { en: "Creator location", sw: "Mahali pa mtayarishi" },
  anywhereInTanzania: { en: "Anywhere in Tanzania", sw: "Mahali popote Tanzania" },
  minFollowers: { en: "Minimum followers", sw: "Wafuasi wa chini" },
  paymentMethod: { en: "Payment method", sw: "Njia ya malipo" },
  paymentCard: { en: "Card", sw: "Kadi" },
  escrow: {
    en: "Funds are held in escrow and any unspent budget returns to you.",
    sw: "Fedha zinashikiliwa kwenye escrow na bajeti isiyotumika inarudi kwako.",
  },
  payNowPrefix: { en: "You pay", sw: "Unalipa" },
  payNowSuffix: { en: "now", sw: "sasa" },
  feeNotAdded: {
    en: "Biboh's 15% is taken from creator payouts, not added to your budget.",
    sw: "Asilimia 15 ya Biboh inakatwa kutoka malipo ya watayarishi, haiongezwi kwenye bajeti yako.",
  },
  back: { en: "Back", sw: "Rudi" },
  next: { en: "Next", sw: "Endelea" },
  fund: { en: "Fund campaign", sw: "Lipia kampeni" },
  funding: { en: "Processing…", sw: "Inashughulikiwa…" },
  successTitle: { en: "Campaign funded!", sw: "Kampeni imelipiwa!" },
  successBody: {
    en: "Creators can now apply. We'll notify you as videos come in.",
    sw: "Watayarishi sasa wanaweza kuomba. Tutakujulisha video zikifika.",
  },
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
  viewsPerCreator2: {
    en: "views per creator at your rate.",
    sw: "mitazamo kwa kila mtayarishi kwa bei yako.",
  },
  minRateMsg: { en: "The minimum rate is", sw: "Bei ya chini ni" },
  minRateMsg2: {
    en: "per 1,000 views. Please raise it to continue.",
    sw: "kwa mitazamo 1,000. Tafadhali iongeze ili kuendelea.",
  },
  minOne: { en: "At least 1 creator is needed.", sw: "Angalau mtayarishi 1 anahitajika." },
  feeNote: {
    en: "Biboh keeps 15% of each creator payout. Creators see their earnings after the fee.",
    sw: "Biboh inachukua 15% ya malipo ya kila mtayarishi. Watayarishi wanaona mapato yao baada ya ada.",
  },
  escrowFull: {
    en: "Funds are held in escrow. Unused budget, including the share of any creator slot that is never filled, returns to you when the campaign ends.",
    sw: "Fedha zinashikiliwa kwenye escrow. Bajeti isiyotumika, ikiwemo sehemu ya nafasi yoyote ya mtayarishi isiyojazwa, inarudi kwako kampeni ikiisha.",
  },
  approvedOf: { en: "creators approved of", sw: "watayarishi wameidhinishwa kati ya" },
  needed: { en: "needed", sw: "wanaohitajika" },
  tabApplicants: { en: "Applicants", sw: "Waombaji" },
  tabContent: { en: "Content", sw: "Maudhui" },
  tabResults: { en: "Results", sw: "Matokeo" },
  tabPayments: { en: "Payments", sw: "Malipo" },
  applicantCountHint: {
    en: "Applicants waiting for your decision",
    sw: "Waombaji wanasubiri uamuzi wako",
  },
  contentCountHint: {
    en: "Videos waiting for your review",
    sw: "Video zinazosubiri ukaguzi wako",
  },
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
  waitingNewVideo: {
    en: "Waiting for the creator's new video",
    sw: "Inasubiri video mpya ya mtayarishi",
  },
  revisionForVideo: {
    en: "For {name}'s video, {date}",
    sw: "Kwa video ya {name}, {date}",
  },
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
  viewsOverTime: { en: "Views over time (cumulative)", sw: "Mitazamo kwa muda (jumla)" },
  ledger: { en: "Escrow ledger", sw: "Daftari la escrow" },
  inEscrow: { en: "In escrow", sw: "Kwenye escrow" },
  funded: { en: "Funded", sw: "Imelipiwa" },
  paidOut: { en: "Paid out to creators", sw: "Imelipwa kwa watayarishi" },
  fee: { en: "Platform fee", sw: "Ada ya jukwaa" },
  returned: { en: "Returned to you", sw: "Imerudishwa kwako" },
  date: { en: "Date", sw: "Tarehe" },
  amount: { en: "Amount", sw: "Kiasi" },
  notFound: { en: "Campaign not found.", sw: "Kampeni haikupatikana." },
  searchName: { en: "Search by name", sw: "Tafuta kwa jina" },
  searchCreators: { en: "Search by name or @handle", sw: "Tafuta kwa jina au @handle" },
  searchCreatorsLabel: { en: "Search creators", sw: "Tafuta watayarishi" },
  filters: { en: "Filters", sw: "Vichujio" },
  platform: { en: "Platform", sw: "Jukwaa" },
  anyNiche: { en: "All niches", sw: "Aina zote" },
  anyPlatform: { en: "All platforms", sw: "Majukwaa yote" },
  anyLocation: { en: "All locations", sw: "Maeneo yote" },
  anyFollowers: { en: "Any followers", sw: "Wafuasi wowote" },
  anyRating: { en: "Any rating", sw: "Ukadiriaji wowote" },
  minRatingLabel: { en: "Minimum rating", sw: "Ukadiriaji wa chini" },
  clearFilters: { en: "Clear filters", sw: "Futa vichujio" },
  nicheFood: { en: "Food", sw: "Chakula" },
  nicheFashion: { en: "Fashion", sw: "Mitindo" },
  nicheBeauty: { en: "Beauty", sw: "Urembo" },
  nicheComedy: { en: "Comedy", sw: "Ucheshi" },
  nicheTech: { en: "Tech", sw: "Teknolojia" },
  creatorFound: { en: "creator found", sw: "mtayarishi amepatikana" },
  creatorsFound: { en: "creators found", sw: "watayarishi wamepatikana" },
  noCreatorsMatch: {
    en: "No creators match your filters.",
    sw: "Hakuna watayarishi wanaolingana na vichujio vyako.",
  },
  profile: { en: "Creator profile", sw: "Wasifu wa mtayarishi" },
  viewProfile: { en: "View profile", sw: "Tazama wasifu" },
  followersByPlatform: { en: "Followers by platform", sw: "Wafuasi kwa jukwaa" },
  about: { en: "About", sw: "Kuhusu" },
  inviteToCampaign: { en: "Invite to campaign", sw: "Alika kwenye kampeni" },
  invitePickerTitle: { en: "Choose a campaign", sw: "Chagua kampeni" },
  invitePickerHelp: {
    en: "Live or draft campaigns with open creator slots.",
    sw: "Kampeni hai au rasimu zilizo na nafasi za watayarishi.",
  },
  openSlots: { en: "Open slots", sw: "Nafasi wazi" },
  invited: { en: "Invited", sw: "Amealikwa" },
  inviteSent: { en: "Invitation sent", sw: "Mwaliko umetumwa" },
  recentCampaigns: { en: "Recent campaigns", sw: "Kampeni za hivi karibuni" },
  noOpenSlots: {
    en: "No campaigns with open slots.",
    sw: "Hakuna kampeni zilizo na nafasi wazi.",
  },
  countingUntilCheckpoint: {
    en: "Counting until checkpoint",
    sw: "Inahesabiwa hadi kituo",
  },
  countingNote: {
    en: "These views aren't paid yet.",
    sw: "Mitazamo hii bado haijalipwa.",
  },
  pending: { en: "Pending", sw: "Inasubiri" },
  status: { en: "Status", sw: "Hali" },
  type: { en: "Type", sw: "Aina" },
  netToCreator: { en: "Creator net total", sw: "Jumla halisi ya mtayarishi" },
  bibohFee: { en: "Biboh fee (15%)", sw: "Ada ya Biboh (15%)" },
  commentPlaceholder: {
    en: "Describe the change in a sentence or two",
    sw: "Eleza mabadiliko kwa sentensi moja au mbili",
  },
  revisionSaved: { en: "Revision request saved.", sw: "Ombi la marekebisho limehifadhiwa." },
  thumbnail: { en: "Video thumbnail", sw: "Picha ndogo ya video" },
  openPost: { en: "Open post in a new tab", sw: "Fungua chapisho kwenye tab mpya" },
  viewPostOn: { en: "View post on", sw: "Tazama chapisho kwenye" },
  slotsFilled: { en: "creator slots filled", sw: "nafasi za watayarishi zimejazwa" },
  ofCap: { en: "of share cap", sw: "ya kikomo cha sehemu" },
  emptyPayments: { en: "No ledger entries yet.", sw: "Bado hakuna maingizo ya daftari." },
  sections: { en: "Campaign sections", sw: "Sehemu za kampeni" },
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

function readCookieLang(): Lang {
  if (typeof document === "undefined") return "en";
  return document.cookie.split("; ").includes(`${LANG_COOKIE}=sw`) ? "sw" : "en";
}

export function AppProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang ?? readCookieLang);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof document !== "undefined")
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  };

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
