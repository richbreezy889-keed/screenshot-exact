export interface DailyPoint {
  date: string;
  views: number;
  spend: number;
}

// Deterministic 30-day series ending 22 Oct 2026
export const dailySeries: DailyPoint[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 22 - 29 + i));
  const wave = Math.sin(i / 3.2) * 18_000 + Math.cos(i / 5) * 9_000;
  const views = Math.round(52_000 + i * 2_100 + wave);
  return { date: d.toISOString().slice(0, 10), views, spend: Math.round((views / 1000) * 4300) };
});

export type AttentionKind = "approveVideo" | "verifyViews" | "applicants";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  campaign: string;
  creator: string;
  count: number;
}

export const attentionItems: AttentionItem[] = [
  { id: "a1", kind: "approveVideo", campaign: "Zuri Glow Serum Launch", creator: "Neema Mushi", count: 3 },
  { id: "a2", kind: "verifyViews", campaign: "Mtaani Wear Street Drop", creator: "Baraka Mwakyusa", count: 48_200 },
  { id: "a3", kind: "applicants", campaign: "Kilele Morning Ritual", creator: "", count: 6 },
  { id: "a4", kind: "approveVideo", campaign: "Kilele Morning Ritual", creator: "Juma Kassim", count: 1 },
];
