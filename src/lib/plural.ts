import type { AttentionKind } from "@/data/dashboard";
import type { TKey } from "@/lib/i18n";

/** Singular only for exactly one, plural for every other count (including zero). */
export function pluralKey(one: TKey, other: TKey, count: number): TKey {
  return count === 1 ? one : other;
}

const attentionLabels: Record<AttentionKind, { one: TKey; other: TKey }> = {
  approveVideo: { one: "approveVideoOne", other: "approveVideo" },
  verifyViews: { one: "verifyViewsOne", other: "verifyViews" },
  applicants: { one: "applicantsOne", other: "applicants" },
};

/** Label for a dashboard attention item, agreed with the count shown beside it. */
export function attentionLabelKey(kind: AttentionKind, count: number): TKey {
  const labels = attentionLabels[kind];
  return pluralKey(labels.one, labels.other, count);
}
