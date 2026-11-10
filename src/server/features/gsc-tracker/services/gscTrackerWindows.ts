import { GscTrackerRepository } from "../repositories/GscTrackerRepository";
import { addDays } from "./gscTrackerDates";

// The comparison windows and metric math shared by the tracker's reports.

type GscTrackerMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export function metrics(
  clicks: number,
  impressions: number,
  positionWeight: number,
): GscTrackerMetrics {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? positionWeight / impressions : null,
  };
}

/** A custom window (both ends inclusive, in either order), and the window
 *  of the same length before it. */
export function customPeriods(from: string, to: string) {
  const [currentStart, currentEnd] = from <= to ? [from, to] : [to, from];
  const length =
    Math.round(
      (Date.parse(`${currentEnd}T00:00:00Z`) -
        Date.parse(`${currentStart}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return {
    currentStart,
    currentEnd,
    previousStart: addDays(currentStart, -length),
    previousEnd: addDays(currentStart, -1),
  };
}

/** The selected window ending at the newest stored day, and the one before. */
export async function periods(siteId: string, days: number) {
  const tracker = await GscTrackerRepository.get(siteId);
  if (!tracker?.newestDate) return null;
  const currentEnd = tracker.newestDate;
  const currentStart = addDays(currentEnd, -(days - 1));
  const previousStart = addDays(currentStart, -days);
  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd: addDays(currentStart, -1),
  };
}
