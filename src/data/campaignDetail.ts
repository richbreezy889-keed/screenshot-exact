export type SubmissionStatus = "awaiting" | "revision" | "approved";
export type ApplicantStatus = "pending" | "approved" | "declined";
export type LedgerKind = "funded" | "paidOut" | "fee" | "returned";

export interface Applicant { creatorId: string; status: ApplicantStatus }
export interface Submission { id: string; creatorId: string; submitted: string; status: SubmissionStatus; note?: string }
export interface ResultRow { creatorId: string; postUrl: string; views: number }
export interface LedgerEntry { id: string; kind: LedgerKind; date: string; amount: number }

export interface CampaignDetailData {
  applicants: Applicant[];
  submissions: Submission[];
  results: ResultRow[];
  viewsOverTime: { date: string; views: number }[];
}

// Per-campaign mock detail. Campaigns not listed get empty detail.
export const campaignDetails: Record<string, CampaignDetailData> = {
  c1: {
    applicants: [
      { creatorId: "u1", status: "approved" },
      { creatorId: "u8", status: "pending" },
      { creatorId: "u6", status: "pending" },
      { creatorId: "u9", status: "pending" },
      { creatorId: "u4", status: "approved" },
    ],
    submissions: [
      { id: "s1", creatorId: "u1", submitted: "2026-10-18", status: "awaiting" },
      { id: "s2", creatorId: "u1", submitted: "2026-10-19", status: "awaiting" },
      { id: "s3", creatorId: "u4", submitted: "2026-10-12", status: "approved" },
      { id: "s4", creatorId: "u4", submitted: "2026-10-20", status: "awaiting" },
    ],
    results: [
      { creatorId: "u1", postUrl: "https://tiktok.com/@neemaglow/video/7421", views: 241_300 },
      { creatorId: "u4", postUrl: "https://tiktok.com/@rehemacheka/video/7398", views: 452_000 },
    ],
    viewsOverTime: series(693_300),
  },
  c2: {
    applicants: [
      { creatorId: "u3", status: "approved" },
      { creatorId: "u7", status: "pending" },
      { creatorId: "u5", status: "pending" },
      { creatorId: "u9", status: "pending" },
      { creatorId: "u2", status: "pending" },
      { creatorId: "u8", status: "pending" },
      { creatorId: "u6", status: "pending" },
    ],
    submissions: [
      { id: "s5", creatorId: "u3", submitted: "2026-10-21", status: "awaiting" },
      { id: "s6", creatorId: "u3", submitted: "2026-10-10", status: "revision", note: "Please show the coffee bag label clearly." },
    ],
    results: [{ creatorId: "u3", postUrl: "https://tiktok.com/@jumakula/video/7350", views: 300_000 }],
    viewsOverTime: series(300_000),
  },
  c3: {
    applicants: [
      { creatorId: "u2", status: "approved" },
      { creatorId: "u6", status: "approved" },
    ],
    submissions: [
      { id: "s7", creatorId: "u2", submitted: "2026-10-05", status: "approved" },
      { id: "s8", creatorId: "u6", submitted: "2026-10-06", status: "approved" },
    ],
    results: [
      { creatorId: "u2", postUrl: "https://tiktok.com/@baraka.fits/video/7301", views: 348_200 },
      { creatorId: "u6", postUrl: "https://tiktok.com/@zawadistyle/video/7302", views: 461_800 },
    ],
    viewsOverTime: series(810_000),
  },
};

function series(total: number) {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 9 + i));
    const frac = 1 - Math.pow(1 - (i + 1) / 14, 2);
    return { date: d.toISOString().slice(0, 10), views: Math.round(total * frac) };
  });
}
