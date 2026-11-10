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

/** The selected window ending at the newest stored day, and the one before. */
export async function periods(projectId: string, days: number) {
  const tracker = await GscTrackerRepository.get(projectId);
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
