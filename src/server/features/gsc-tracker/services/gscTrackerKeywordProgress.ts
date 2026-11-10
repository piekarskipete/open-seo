import {
  GscTrackerKeywordRepository,
  type GscTrackerKeyword,
} from "../repositories/GscTrackerKeywordRepository";
import { addDays } from "./gscTrackerDates";
import { comparableUrl } from "@/shared/gsc-tracker";

// How far past the start date to look for its first position: Search Console
// lags about two days and a page doesn't show every day.
const START_WINDOW_DAYS = 31;

type PageDay = {
  date: string;
  page: string;
  impressions: number;
  position: number;
};

/** The day progress is measured from: set by hand, or the day it was added. */
function startDateOf(
  keyword: Pick<GscTrackerKeyword, "startDate" | "createdAt">,
): string {
  return keyword.startDate ?? keyword.createdAt.slice(0, 10);
}

/** The target URL's days only, oldest first. */
function targetDays(rows: PageDay[], targetUrl: string): PageDay[] {
  const target = comparableUrl(targetUrl);
  const days = rows.filter((row) => comparableUrl(row.page) === target);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

/** Average position weighted by impressions, or null without impressions. */
function averagePosition(days: PageDay[]): number | null {
  const impressions = days.reduce((sum, day) => sum + day.impressions, 0);
  if (impressions === 0) return null;
  return (
    days.reduce((sum, day) => sum + day.position * day.impressions, 0) /
    impressions
  );
}

/**
 * A phrase's progress on its target URL, shown beside the month's totals:
 * - start: the position on its start date, or the first measured day after;
 * - lastMonth: the previous month's average, and the move into this month;
 * - latest: the month's last measured day, and the move since the one before.
 * A positive `change` is an improvement (a smaller position number).
 */
export async function keywordProgress(input: {
  keyword: GscTrackerKeyword;
  /** The phrase's page-days from the previous month's start to this month's end. */
  rows: PageDay[];
  monthStart: string;
}) {
  const { keyword, monthStart } = input;
  const startDate = startDateOf(keyword);
  const previousMonthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
  const target = targetDays(input.rows, keyword.targetUrl);
  const thisMonth = target.filter((day) => day.date >= monthStart);
  const lastMonth = target.filter(
    (day) => day.date >= previousMonthStart && day.date < monthStart,
  );

  const monthPosition = averagePosition(thisMonth);
  const lastMonthPosition = averagePosition(lastMonth);
  const latest = thisMonth.at(-1);
  const beforeLatest = latest
    ? target.filter((day) => day.date < latest.date).at(-1)
    : undefined;

  const startRows = await GscTrackerKeywordRepository.listKeywordDays({
    keywordId: keyword.id,
    from: startDate,
    to: addDays(startDate, START_WINDOW_DAYS),
  });
  const start = targetDays(startRows, keyword.targetUrl)[0];

  return {
    startDate,
    startIsDefault: keyword.startDate === null,
    start: start ? { date: start.date, position: start.position } : null,
    lastMonth:
      lastMonthPosition === null
        ? null
        : {
            position: lastMonthPosition,
            change:
              monthPosition === null ? null : lastMonthPosition - monthPosition,
          },
    latest: latest
      ? {
          date: latest.date,
          position: latest.position,
          change: beforeLatest ? beforeLatest.position - latest.position : null,
        }
      : null,
  };
}
