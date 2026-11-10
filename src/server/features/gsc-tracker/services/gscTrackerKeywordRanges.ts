import { addDays } from "./gscTrackerDates";
import { metrics } from "./gscTrackerWindows";

// How far from a marker day to look for a measured position: a page
// doesn't show every day.
const POINT_WINDOW_DAYS = 31;

export type TargetDay = { clicks: number; impressions: number; weight: number };

type Point = { date: string; position: number };

function positionOn(date: string, day: TargetDay): Point {
  return { date, position: day.weight / day.impressions };
}

/** The earliest or latest measured day between `from` and `to`. */
function edgePoint(
  days: Map<string, TargetDay>,
  from: string,
  to: string,
  edge: "first" | "last",
): Point | null {
  let found: Point | null = null;
  for (const [date, day] of days) {
    if (date < from || date > to || day.impressions === 0) continue;
    const earlier = found === null || date < found.date;
    if (found === null || (edge === "first" ? earlier : !earlier))
      found = positionOn(date, day);
  }
  return found;
}

const firstPoint = (days: Map<string, TargetDay>, from: string, to: string) =>
  edgePoint(days, from, to, "first");
const lastPoint = (days: Map<string, TargetDay>, from: string, to: string) =>
  edgePoint(days, from, to, "last");

/** Where a phrase stood at its start (first measured day from then on) and
 *  at each checkpoint (last measured day up to it). */
export function markerPoints(
  days: Map<string, TargetDay>,
  startDate: string,
  checkpoints: string[],
) {
  return {
    start: {
      date: startDate,
      point: firstPoint(days, startDate, addDays(startDate, POINT_WINDOW_DAYS)),
    },
    checkpoints: checkpoints.map((date) => ({
      date,
      point: lastPoint(days, addDays(date, -POINT_WINDOW_DAYS), date),
    })),
  };
}

/**
 * A stretch between two days: totals, average position, and the position
 * at each end with the move between them (positive = improved).
 */
export function rangeStats(
  days: Map<string, TargetDay>,
  from: string,
  to: string,
) {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const inside = [...days]
    .filter(([date]) => date >= start && date <= end)
    .map(([, day]) => day);
  const sum = inside.reduce(
    (acc, day) => ({
      clicks: acc.clicks + day.clicks,
      impressions: acc.impressions + day.impressions,
      weight: acc.weight + day.weight,
    }),
    { clicks: 0, impressions: 0, weight: 0 },
  );
  const first = firstPoint(days, start, end);
  const last = lastPoint(days, start, end);
  return {
    from: start,
    to: end,
    ...metrics(sum.clicks, sum.impressions, sum.weight),
    first,
    last,
    change:
      first && last && first.date !== last.date
        ? first.position - last.position
        : null,
  };
}
