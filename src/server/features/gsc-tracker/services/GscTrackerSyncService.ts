import {
  GscTrackerRepository,
  type GscTrackerProject,
} from "../repositories/GscTrackerRepository";
import {
  addDays,
  gscTrackerFloor,
  gscTrackerLatestDay,
  readRowsPerDay,
} from "./gscTrackerDates";
import {
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { describeError } from "@/server/lib/errors";

/** What the tracker page shows after a failed sync. */
function syncErrorMessage(error: unknown): string {
  if (error instanceof GscNotConnectedError)
    return "Search Console isn't connected to this project.";
  if (isExpectedGrantFailure(error))
    return "Search Console refused access: the connection expired or lost permission for this property. Reconnect it in this project's Integrations.";
  return "Search Console didn't answer. The next sync tries again.";
}

// Days fetched per project per tick: one Search Console call each, plus one
// call for the batch's totals. Small enough for the free Workers plan's
// subrequest cap; the 5-minute cron catches a 16-month backfill up within a
// few hours.
const DAYS_PER_TICK = 6;
// The cron also runs rank checks and AI visibility; the tracker stops
// starting projects after this.
const TICK_DEADLINE_MS = 60_000;
// Search Console keeps revising the last few days, so they are fetched again
// this often, and this many of them.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REFRESH_DAYS = 4;

function isStale(lastSyncedAt: string | null, now: Date): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - new Date(lastSyncedAt).getTime() > REFRESH_INTERVAL_MS;
}

/** The days this tick should fetch for a project, newest work first: the
 *  recent days (on a fresh tracker or a stale refresh), then older history. */
export function planSyncDays(
  tracker: Pick<
    GscTrackerProject,
    "oldestDate" | "newestDate" | "lastSyncedAt"
  >,
  now: Date,
  budget = DAYS_PER_TICK,
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

/** Whether a tracker has anything to fetch now. */
function isTrackerDue(tracker: GscTrackerProject, now: Date): boolean {
  const { forward, backward } = planSyncDays(tracker, now, 1);
  return (
    forward.length > 0 ||
    backward.length > 0 ||
    isStale(tracker.lastSyncedAt, now)
  );
}

async function fetchDay(projectId: string, date: string, rowLimit: number) {
  const { rows } = await GscService.getPerformance({
    projectId,
    startDate: date,
    endDate: date,
    dimensions: ["query", "page"],
    rowLimit,
  });
  return rows.flatMap((row) => {
    const [query, page] = row.keys ?? [];
    if (!query || !page) return [];
    return [
      {
        query,
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      },
    ];
  });
}

async function fetchTotals(projectId: string, days: string[]) {
  const sorted = [...days];
  sorted.sort();
  const { rows } = await GscService.getPerformance({
    projectId,
    startDate: sorted[0],
    endDate: sorted[sorted.length - 1],
    dimensions: ["date"],
    rowLimit: 1000,
  });
  const wanted = new Set(days);
  return rows.flatMap((row) => {
    const date = row.keys?.[0];
    if (!date || !wanted.has(date)) return [];
    return [
      {
        date,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      },
    ];
  });
}

/** Fetches one batch of days for a project and records how far it got. */
export async function syncTracker(
  tracker: GscTrackerProject,
  now = new Date(),
): Promise<void> {
  const connection = await GscService.getConnection(tracker.projectId);
  if (!connection) {
    await GscTrackerRepository.update(tracker.projectId, {
      lastError: "Search Console isn't connected to this project.",
    });
    return;
  }
  let state = tracker;
  // History belongs to one property; a new property starts over.
  if (connection.siteUrl !== tracker.siteUrl) {
    await GscTrackerRepository.clearHistory(tracker.projectId);
    state = {
      ...tracker,
      siteUrl: connection.siteUrl,
      oldestDate: null,
      newestDate: null,
      lastSyncedAt: null,
    };
    await GscTrackerRepository.update(tracker.projectId, {
      siteUrl: connection.siteUrl,
      oldestDate: null,
      newestDate: null,
      lastSyncedAt: null,
      lastError: null,
    });
  }

  const { forward, backward } = planSyncDays(state, now);
  const days = [...forward, ...backward];
  if (days.length === 0) {
    if (isStale(state.lastSyncedAt, now))
      await GscTrackerRepository.update(tracker.projectId, {
        lastSyncedAt: now.toISOString(),
        lastError: null,
      });
    return;
  }

  const rowLimit = await readRowsPerDay();
  try {
    const totals = await fetchTotals(tracker.projectId, days);
    for (const date of days) {
      const rows = await fetchDay(tracker.projectId, date, rowLimit);
      await GscTrackerRepository.replaceDay({
        projectId: tracker.projectId,
        date,
        rows,
      });
    }
    await GscTrackerRepository.replaceTotals({
      projectId: tracker.projectId,
      dates: days,
      totals,
    });
  } catch (error) {
    await GscTrackerRepository.update(tracker.projectId, {
      lastError: syncErrorMessage(error),
    });
    console.error("[gsc-tracker] sync failed", {
      projectId: tracker.projectId,
      error: describeError(error),
    });
    return;
  }

  const fetched = [...days];
  fetched.sort();
  const oldest = fetched[0];
  const newest = fetched[fetched.length - 1];
  await GscTrackerRepository.update(tracker.projectId, {
    oldestDate:
      state.oldestDate && state.oldestDate < oldest ? state.oldestDate : oldest,
    newestDate:
      state.newestDate && state.newestDate > newest ? state.newestDate : newest,
    // A tick that reached the latest day counts as a refresh.
    ...(forward.length > 0 &&
    forward[forward.length - 1] === gscTrackerLatestDay(now)
      ? { lastSyncedAt: now.toISOString() }
      : {}),
    lastError: null,
  });
}

/** Cron body: one batch for every tracker with work left. */
export async function runScheduledGscTracker(now = new Date()) {
  const deadline = Date.now() + TICK_DEADLINE_MS;
  for (const tracker of await GscTrackerRepository.listAll()) {
    if (Date.now() >= deadline) break;
    if (!isTrackerDue(tracker, now)) continue;
    try {
      await syncTracker(tracker, now);
    } catch (error) {
      console.error("[gsc-tracker] tracker sync crashed", {
        projectId: tracker.projectId,
        error: describeError(error),
      });
    }
  }
}
