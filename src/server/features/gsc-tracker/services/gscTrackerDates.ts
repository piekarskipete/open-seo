import { sixteenMonthFloor } from "@/server/features/gsc/searchAnalytics";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Search Console shows fresh (still changing) data about two days back; the
// tracker stores up to then and refetches the last days as they settle.
const LATEST_DAY_LAG = 2;

const DEFAULT_ROWS_PER_DAY = 1000;
const MAX_ROWS_PER_DAY = 25_000;

/** YYYY-MM-DD shifted by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysBetween(start: string, end: string): number {
  return (
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

/** The newest day the tracker stores. */
export function gscTrackerLatestDay(now: Date): string {
  return addDays(now.toISOString().slice(0, 10), -LATEST_DAY_LAG);
}

/** The oldest day the tracker fetches: the same 16-month floor the request
 *  builder clamps start dates to, so a single-day request is never turned
 *  into an empty (and rejected) range. */
export function gscTrackerFloor(now: Date): string {
  return sixteenMonthFloor(now);
}

/**
 * Query/page rows kept per day: Search Console's top rows by clicks. A
 * thousand covers most of a typical site's clicks while keeping 16 months
 * small enough for a free D1 database; Postgres self-hosts can raise it with
 * GSC_TRACKER_ROWS_PER_DAY (up to 25,000, Google's page size).
 */
export async function readRowsPerDay(): Promise<number> {
  const raw = Number(await getOptionalEnvValue("GSC_TRACKER_ROWS_PER_DAY"));
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_ROWS_PER_DAY;
  return Math.min(Math.floor(raw), MAX_ROWS_PER_DAY);
}
