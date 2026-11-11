import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { addDays, gscTrackerLatestDay } from "./gscTrackerDates";
import {
  markerPoints,
  rangeStats,
  type TargetDay,
} from "./gscTrackerKeywordRanges";
import { comparableUrl } from "@/shared/gsc-tracker";

// Followed phrases grouped by their checkpoints: phrases measured at the
// same checkpoint days form one cohort, so a batch of changes (say, pages
// rewritten in one month) can be judged together.

// How far before a start or checkpoint a measured day is looked for, as in
// the phrase chart.
const LOOKBACK_DAYS = 31;
// A move smaller than this reads as noise.
const MOVE_STEP = 1;

type Phrase = {
  id: string;
  query: string;
  start: number | null;
  checkpoints: (number | null)[];
  now: number | null;
};

function average(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0) / known.length;
}

/** Positions gained from the start to the last checkpoint (positive =
 *  better), or null when either end wasn't measured. */
function gained(phrase: Phrase): number | null {
  const last = phrase.checkpoints[phrase.checkpoints.length - 1] ?? null;
  return phrase.start !== null && last !== null ? phrase.start - last : null;
}

/** The day progress is measured from: the start date, or the day the
 *  phrase was added. */
function startOf(keyword: { startDate: string | null; createdAt: string }) {
  return keyword.startDate ?? keyword.createdAt.slice(0, 10);
}

/** A cohort's last checkpoint day. */
function lastDay(checkpoints: string[]): string {
  return checkpoints[checkpoints.length - 1] ?? "";
}

/** The site's checkpoint cohorts, newest checkpoint first: each with its
 *  days, average positions at the start, each checkpoint and now, how many
 *  phrases moved up or down by the last checkpoint, and the phrases. */
export async function getCheckpointSummary(siteId: string, now = new Date()) {
  const keywords = (await GscTrackerKeywordRepository.list(siteId)).filter(
    (keyword) => keyword.checkpoint1Date !== null,
  );
  if (keywords.length === 0) return { cohorts: [] };
  const latest = gscTrackerLatestDay(now);
  const earliest = keywords
    .map(startOf)
    .reduce((first, date) => (date < first ? date : first));
  const rows = await GscTrackerKeywordRepository.listDays({
    siteId,
    from: addDays(earliest, -LOOKBACK_DAYS),
    to: latest,
  });

  const cohorts = new Map<
    string,
    { checkpoints: string[]; phrases: Phrase[] }
  >();
  for (const keyword of keywords) {
    const target = comparableUrl(keyword.targetUrl);
    const days = new Map<string, TargetDay>();
    for (const row of rows) {
      if (row.keywordId !== keyword.id || comparableUrl(row.page) !== target)
        continue;
      const day = days.get(row.date) ?? {
        clicks: 0,
        impressions: 0,
        weight: 0,
      };
      day.clicks += row.clicks;
      day.impressions += row.impressions;
      day.weight += row.position * row.impressions;
      days.set(row.date, day);
    }
    const checkpoints = [
      keyword.checkpoint1Date,
      keyword.checkpoint2Date,
    ].filter((date): date is string => date !== null);
    const startDate = startOf(keyword);
    const points = markerPoints(days, startDate, checkpoints);
    const key = checkpoints.join(" ");
    const cohort = cohorts.get(key) ?? { checkpoints, phrases: [] };
    cohort.phrases.push({
      id: keyword.id,
      query: keyword.query,
      start: points.start.point?.position ?? null,
      checkpoints: points.checkpoints.map(
        (item) => item.point?.position ?? null,
      ),
      now: rangeStats(days, startDate, latest).last?.position ?? null,
    });
    cohorts.set(key, cohort);
  }

  const list = [...cohorts.values()].map((cohort) => {
    const moves = cohort.phrases.map(gained);
    const phrases = [...cohort.phrases];
    phrases.sort((a, b) => (gained(b) ?? -Infinity) - (gained(a) ?? -Infinity));
    return {
      checkpoints: cohort.checkpoints,
      phraseCount: cohort.phrases.length,
      average: {
        start: average(cohort.phrases.map((phrase) => phrase.start)),
        checkpoints: cohort.checkpoints.map((_, index) =>
          average(
            cohort.phrases.map((phrase) => phrase.checkpoints[index] ?? null),
          ),
        ),
        now: average(cohort.phrases.map((phrase) => phrase.now)),
      },
      improved: moves.filter((move) => move !== null && move >= MOVE_STEP)
        .length,
      declined: moves.filter((move) => move !== null && move <= -MOVE_STEP)
        .length,
      phrases,
    };
  });
  list.sort((a, b) =>
    lastDay(b.checkpoints).localeCompare(lastDay(a.checkpoints)),
  );
  return { cohorts: list };
}
