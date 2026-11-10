import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { addDays, daysBetween, gscTrackerLatestDay } from "./gscTrackerDates";
import { metrics } from "./gscTrackerWindows";
import {
  markerPoints,
  rangeStats,
  type TargetDay,
} from "./gscTrackerKeywordRanges";
import { comparableUrl } from "@/shared/gsc-tracker";

type Day = TargetDay;

function total(days: Day[]) {
  return days.reduce(
    (sum, day) => ({
      clicks: sum.clicks + day.clicks,
      impressions: sum.impressions + day.impressions,
      weight: sum.weight + day.weight,
    }),
    { clicks: 0, impressions: 0, weight: 0 },
  );
}

/**
 * A followed phrase on its target URL over the last `days` days: one point
 * per day (days without impressions have no position), the period's totals
 * and per-day averages, and the previous period of the same length.
 */
export async function getKeywordChart(input: {
  projectId: string;
  id: string;
  days: number;
  now?: Date;
}) {
  const keywords = await GscTrackerKeywordRepository.list(input.projectId);
  const keyword = keywords.find((entry) => entry.id === input.id);
  if (!keyword) throw new AppError("NOT_FOUND", "That phrase isn't followed.");

  const end =
    keyword.newestDate ?? gscTrackerLatestDay(input.now ?? new Date());
  const start = addDays(end, -(input.days - 1));
  const previousStart = addDays(start, -input.days);
  const target = comparableUrl(keyword.targetUrl);
  const startDate = keyword.startDate ?? keyword.createdAt.slice(0, 10);
  const checkpoints = [keyword.checkpoint1Date, keyword.checkpoint2Date].filter(
    (date): date is string => date !== null,
  );
  // Every stored day, so the start and checkpoint stats reach past the
  // chart's period.
  const rows = await GscTrackerKeywordRepository.listKeywordDays({
    keywordId: keyword.id,
    from: [startDate, ...checkpoints].reduce(
      (earliest, date) => (date < earliest ? date : earliest),
      previousStart,
    ),
    to: end,
  });

  const byDate = new Map<string, Day>();
  for (const row of rows) {
    if (comparableUrl(row.page) !== target) continue;
    const day = byDate.get(row.date) ?? {
      clicks: 0,
      impressions: 0,
      weight: 0,
    };
    day.clicks += row.clicks;
    day.impressions += row.impressions;
    day.weight += row.position * row.impressions;
    byDate.set(row.date, day);
  }

  const series = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const day = byDate.get(date) ?? { clicks: 0, impressions: 0, weight: 0 };
    series.push({ date, ...metrics(day.clicks, day.impressions, day.weight) });
  }
  const inRange = (from: string, to: string) =>
    [...byDate]
      .filter(([date]) => date >= from && date <= to)
      .map(([, d]) => d);
  const current = total(inRange(start, end));
  const previous = total(inRange(previousStart, addDays(start, -1)));
  // Days the phrase has been fetched for within the period, so per-day
  // averages aren't diluted by days before it was followed.
  const fetchedFrom =
    keyword.oldestDate && keyword.oldestDate > start
      ? keyword.oldestDate
      : start;
  const fetchedDays = keyword.oldestDate
    ? Math.max(1, daysBetween(fetchedFrom, end))
    : input.days;

  return {
    start,
    end,
    oldestDate: keyword.oldestDate,
    series,
    current: metrics(current.clicks, current.impressions, current.weight),
    previous: metrics(previous.clicks, previous.impressions, previous.weight),
    markers: markerPoints(byDate, startDate, checkpoints),
    // From the start date to the newest day, and the checkpoint stretch:
    // start to checkpoint 1, or checkpoint 1 to checkpoint 2.
    sinceStart: rangeStats(byDate, startDate, end),
    checkpointRange:
      checkpoints.length === 0
        ? null
        : {
            fromLabel: checkpoints.length === 2 ? "Checkpoint 1" : "Start",
            toLabel: checkpoints.length === 2 ? "Checkpoint 2" : "Checkpoint 1",
            ...(checkpoints.length === 2
              ? rangeStats(byDate, checkpoints[0] ?? end, checkpoints[1] ?? end)
              : rangeStats(byDate, startDate, checkpoints[0] ?? end)),
          },
    perDay: {
      clicks: current.clicks / fetchedDays,
      impressions: current.impressions / fetchedDays,
    },
  };
}
