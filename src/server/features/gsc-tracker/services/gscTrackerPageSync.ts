import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import {
  GscTrackerPageRepository,
  type GscTrackerPageDayRow,
} from "../repositories/GscTrackerPageRepository";
import { querySite } from "./gscTrackerAccess";
import {
  daysBetween,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { isStale, planSyncDays, syncErrorMessage } from "./gscTrackerPlan";
import { describeError } from "@/server/lib/errors";

// Per-page history: one page-only query per run of days (date and page as
// dimensions), so it costs far fewer calls than the query/page rows and a
// 16-month backfill takes a few ticks.
const PAGE_DAYS_PER_TICK = 30;
// Google's page size, and how many pages of it one run reads. A site with
// more page/day rows than that keeps its top ones by clicks.
const PAGE_ROW_LIMIT = 25_000;
const MAX_REQUESTS_PER_RUN = 4;

/** Every page's numbers for a run of days, both ends inclusive. */
async function fetchPageDays(
  site: GscTrackerSite,
  days: string[],
): Promise<GscTrackerPageDayRow[]> {
  const sorted = [...days];
  sorted.sort();
  const wanted = new Set(days);
  const rows: GscTrackerPageDayRow[] = [];
  for (let request = 0; request < MAX_REQUESTS_PER_RUN; request++) {
    const { rows: page } = await querySite(site, {
      startDate: sorted[0],
      endDate: sorted[sorted.length - 1],
      dimensions: ["date", "page"],
      rowLimit: PAGE_ROW_LIMIT,
      startRow: request * PAGE_ROW_LIMIT,
    });
    for (const row of page) {
      const [date, url] = row.keys ?? [];
      if (!date || !url || !wanted.has(date)) continue;
      rows.push({
        date,
        page: url,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      });
    }
    if (page.length < PAGE_ROW_LIMIT) break;
  }
  return rows;
}

/** The site's page-history range, as the shared day planner reads it. */
function pageRange(site: GscTrackerSite) {
  return {
    oldestDate: site.pagesOldestDate,
    newestDate: site.pagesNewestDate,
    lastSyncedAt: site.pagesSyncedAt,
  };
}

/** Whether the page history has anything to fetch now. */
export function isPageHistoryDue(site: GscTrackerSite, now: Date): boolean {
  const { forward, backward } = planSyncDays(pageRange(site), now, 1);
  return (
    forward.length > 0 ||
    backward.length > 0 ||
    isStale(site.pagesSyncedAt, now)
  );
}

/** Share of the 16-month page history stored so far, 0 to 1. */
export function pageHistoryProgress(site: GscTrackerSite, now = new Date()) {
  if (!site.pagesOldestDate || !site.pagesNewestDate) return 0;
  return Math.min(
    1,
    daysBetween(site.pagesOldestDate, site.pagesNewestDate) /
      daysBetween(gscTrackerFloor(now), gscTrackerLatestDay(now)),
  );
}

/** Fetches one batch of page days for a site: recent days first, then
 *  older history, each run in one request. */
export async function syncPageDays(
  site: GscTrackerSite,
  now = new Date(),
): Promise<void> {
  const { forward, backward } = planSyncDays(
    pageRange(site),
    now,
    PAGE_DAYS_PER_TICK,
  );
  const days = [...forward, ...backward];
  if (days.length === 0) {
    if (isStale(site.pagesSyncedAt, now))
      await GscTrackerRepository.update(site.id, {
        pagesSyncedAt: now.toISOString(),
      });
    return;
  }
  try {
    for (const run of [forward, backward]) {
      if (run.length === 0) continue;
      await GscTrackerPageRepository.replaceDays({
        site,
        dates: run,
        rows: await fetchPageDays(site, run),
      });
    }
  } catch (error) {
    await GscTrackerRepository.update(site.id, {
      lastError: syncErrorMessage(error),
    });
    console.error("[gsc-tracker] page sync failed", {
      siteId: site.id,
      error: describeError(error),
    });
    return;
  }
  const fetched = [...days];
  fetched.sort();
  const oldest = fetched[0];
  const newest = fetched[fetched.length - 1];
  await GscTrackerRepository.update(site.id, {
    pagesOldestDate:
      site.pagesOldestDate && site.pagesOldestDate < oldest
        ? site.pagesOldestDate
        : oldest,
    pagesNewestDate:
      site.pagesNewestDate && site.pagesNewestDate > newest
        ? site.pagesNewestDate
        : newest,
    ...(forward.length > 0 &&
    forward[forward.length - 1] === gscTrackerLatestDay(now)
      ? { pagesSyncedAt: now.toISOString() }
      : {}),
  });
}
