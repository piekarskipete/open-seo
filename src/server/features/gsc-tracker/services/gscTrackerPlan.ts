import {
  addDays,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { isExpectedGrantFailure } from "@/server/features/gsc/services/GscService";
import { GscNotConnectedError } from "@/server/lib/gscErrors";

// Which days a sync fetches, shared by the property history and the
// followed phrases: both keep a stored range and refresh its newest days.

/** A stored day range, both ends inclusive, and when its newest days were
 *  last refreshed. */
type SyncRange = {
  oldestDate: string | null;
  newestDate: string | null;
  lastSyncedAt: string | null;
};

/** What the tracker page shows after a failed sync. */
export function syncErrorMessage(error: unknown): string {
  if (error instanceof GscNotConnectedError)
    return "Search Console isn't connected to this project.";
  if (isExpectedGrantFailure(error))
    return "Search Console refused access: the connection expired or lost permission for this property. Reconnect it in this project's Integrations.";
  return "Search Console didn't answer. The next sync tries again.";
}

// Search Console keeps revising the last few days, so they are fetched again
// this often, and this many of them.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REFRESH_DAYS = 4;

export function isStale(lastSyncedAt: string | null, now: Date): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - new Date(lastSyncedAt).getTime() > REFRESH_INTERVAL_MS;
}

/** The days this tick should fetch for a project, newest work first: the
 *  recent days (on a fresh tracker or a stale refresh), then older history. */
export function planSyncDays(
  tracker: SyncRange,
  now: Date,
  budget = 6,
): { forward: string[]; backward: string[] } {
  const latest = gscTrackerLatestDay(now);
  const floor = gscTrackerFloor(now);
  const forward: string[] = [];
  let start = tracker.newestDate
    ? addDays(tracker.newestDate, 1)
    : addDays(latest, -(REFRESH_DAYS - 1));
  if (tracker.newestDate && isStale(tracker.lastSyncedAt, now)) {
    const refreshStart = addDays(latest, -(REFRESH_DAYS - 1));
    if (refreshStart < start) start = refreshStart;
  }
  for (
    let day = start;
    day <= latest && forward.length < budget;
    day = addDays(day, 1)
  )
    forward.push(day);

  const backward: string[] = [];
  const oldest = tracker.oldestDate ?? forward[0] ?? latest;
  for (
    let day = addDays(oldest, -1);
    day >= floor && forward.length + backward.length < budget;
    day = addDays(day, -1)
  )
    backward.push(day);
  return { forward, backward };
}
