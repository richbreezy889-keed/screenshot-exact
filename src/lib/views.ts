export interface ViewsPoint {
  date: string;
  views: number;
}

/**
 * Views added over the most recent `days` of a cumulative series.
 * `viewsOverTime` stores running totals, so subtracting the value `days`
 * points back gives the slice added since then.
 */
export function recentViews(points: ViewsPoint[], days = 7): number {
  if (points.length === 0 || days <= 0) return 0;
  const last = points[points.length - 1]?.views ?? 0;
  const startIndex = Math.max(0, points.length - 1 - days);
  const before = points[startIndex]?.views ?? 0;
  return Math.max(0, last - before);
}
