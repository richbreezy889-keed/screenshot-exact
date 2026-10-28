export type SubmissionStatus = "awaiting" | "revision" | "approved";
export type ApplicantStatus = "pending" | "approved" | "declined";
export type LedgerKind = "funded" | "paidOut" | "fee" | "returned";

export interface Applicant {
  creatorId: string;
  status: ApplicantStatus;
}
export interface Submission {
  id: string;
  creatorId: string;
  submitted: string;
  status: SubmissionStatus;
  note?: string;
}
export interface ResultRow {
  creatorId: string;
  postUrl: string;
  views: number;
}
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  date: string;
  amount: number;
}

export interface CampaignDetailData {
  applicants: Applicant[];
  submissions: Submission[];
  results: ResultRow[];
  viewsOverTime: { date: string; views: number }[];
}

// Per-campaign mock detail. Campaigns not listed get empty detail.
// The number of applicants with status "approved" must equal the campaign's
// creatorsApproved value in src/data/campaigns.ts — see payout-rules.test.ts.
export const campaignDetails: Record<string, CampaignDetailData> = {
  c1: {
    applicants: [
      { creatorId: "u1", status: "approved" },
      { creatorId: "u4", status: "approved" },
      { creatorId: "u8", status: "approved" },
      { creatorId: "u10", status: "approved" },
      { creatorId: "u11", status: "approved" },
      { creatorId: "u12", status: "approved" },
      { creatorId: "u13", status: "approved" },
      { creatorId: "u14", status: "approved" },
      { creatorId: "u9", status: "pending" },
      { creatorId: "u15", status: "pending" },
    ],
    submissions: [
      { id: "s1", creatorId: "u1", submitted: "2026-10-18", status: "awaiting" },
      { id: "s2", creatorId: "u1", submitted: "2026-10-19", status: "awaiting" },
      { id: "s3", creatorId: "u4", submitted: "2026-10-12", status: "approved" },
      { id: "s4", creatorId: "u4", submitted: "2026-10-20", status: "awaiting" },
    ],
    results: [
      { creatorId: "u1", postUrl: "https://tiktok.com/@neemaglow/video/7421", views: 84_600 },
      { creatorId: "u8", postUrl: "https://tiktok.com/@imanibeauty/video/7402", views: 96_200 },
      { creatorId: "u13", postUrl: "https://tiktok.com/@nadiabeauty/video/7409", views: 120_400 },
      { creatorId: "u4", postUrl: "https://tiktok.com/@rehemacheka/video/7398", views: 60_000 },
    ],
    viewsOverTime: series(361_200),
  },
  c2: {
    applicants: [
      { creatorId: "u3", status: "approved" },
      { creatorId: "u7", status: "approved" },
      { creatorId: "u16", status: "approved" },
      { creatorId: "u17", status: "approved" },
      { creatorId: "u18", status: "approved" },
      { creatorId: "u5", status: "pending" },
    ],
    submissions: [
      { id: "s5", creatorId: "u3", submitted: "2026-10-21", status: "awaiting" },
      {
        id: "s6",
        creatorId: "u3",
        submitted: "2026-10-10",
        status: "revision",
        note: "Please show the coffee bag label clearly.",
      },
    ],
    results: [
      { creatorId: "u3", postUrl: "https://tiktok.com/@jumakula/video/7350", views: 95_000 },
      { creatorId: "u7", postUrl: "https://instagram.com/p/farajicooks-kilele", views: 140_000 },
    ],
    viewsOverTime: series(235_000),
  },
  c3: {
    applicants: [
      { creatorId: "u2", status: "approved" },
      { creatorId: "u6", status: "approved" },
      { creatorId: "u21", status: "approved" },
      { creatorId: "u22", status: "approved" },
      { creatorId: "u23", status: "approved" },
      { creatorId: "u24", status: "approved" },
      { creatorId: "u25", status: "approved" },
      { creatorId: "u26", status: "approved" },
      { creatorId: "u27", status: "approved" },
      { creatorId: "u28", status: "approved" },
      { creatorId: "u29", status: "approved" },
      { creatorId: "u30", status: "approved" },
    ],
    submissions: [
      { id: "s7", creatorId: "u2", submitted: "2026-10-05", status: "approved" },
      { id: "s8", creatorId: "u6", submitted: "2026-10-06", status: "approved" },
    ],
    results: [
      { creatorId: "u2", postUrl: "https://tiktok.com/@baraka.fits/video/7301", views: 62_400 },
      { creatorId: "u6", postUrl: "https://tiktok.com/@zawadistyle/video/7302", views: 70_200 },
      { creatorId: "u21", postUrl: "https://tiktok.com/@aminastyles/video/7315", views: 88_000 },
    ],
    viewsOverTime: series(220_600),
  },
  c4: {
    applicants: [
      { creatorId: "u3", status: "approved" },
      { creatorId: "u7", status: "approved" },
      { creatorId: "u16", status: "approved" },
      { creatorId: "u17", status: "approved" },
      { creatorId: "u18", status: "approved" },
      { creatorId: "u19", status: "approved" },
      { creatorId: "u20", status: "approved" },
    ],
    submissions: [
      { id: "s9", creatorId: "u3", submitted: "2026-09-12", status: "approved" },
      { id: "s10", creatorId: "u16", submitted: "2026-09-14", status: "approved" },
      { id: "s11", creatorId: "u17", submitted: "2026-09-15", status: "approved" },
    ],
    results: [
      { creatorId: "u3", postUrl: "https://tiktok.com/@jumakula/video/7210", views: 60_000 },
      { creatorId: "u16", postUrl: "https://instagram.com/p/isayaeats-darbites", views: 72_500 },
      { creatorId: "u17", postUrl: "https://instagram.com/p/lisamango-darbites", views: 95_000 },
    ],
    viewsOverTime: series(227_500),
  },
  c6: {
    applicants: [
      { creatorId: "u4", status: "approved" },
      { creatorId: "u9", status: "approved" },
      { creatorId: "u31", status: "approved" },
      { creatorId: "u32", status: "approved" },
    ],
    submissions: [
      { id: "s12", creatorId: "u4", submitted: "2026-08-10", status: "approved" },
      { id: "s13", creatorId: "u31", submitted: "2026-08-11", status: "approved" },
    ],
    results: [
      { creatorId: "u4", postUrl: "https://tiktok.com/@rehemacheka/video/7102", views: 90_000 },
      { creatorId: "u31", postUrl: "https://tiktok.com/@bellaskits/video/7103", views: 135_000 },
    ],
    viewsOverTime: series(225_000),
  },
};

function series(total: number) {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 9 + i));
    const frac = 1 - Math.pow(1 - (i + 1) / 14, 2);
    return { date: d.toISOString().slice(0, 10), views: Math.round(total * frac) };
  });
}
