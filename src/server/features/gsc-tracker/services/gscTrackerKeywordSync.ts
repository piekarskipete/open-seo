import {
  GscTrackerKeywordRepository,
  type GscTrackerKeyword,
} from "../repositories/GscTrackerKeywordRepository";
import {
  GscTrackerRepository,
  type GscTrackerProject,
} from "../repositories/GscTrackerRepository";
import { gscTrackerLatestDay } from "./gscTrackerDates";
import { planSyncDays, syncErrorMessage } from "./gscTrackerPlan";
import { GscService } from "@/server/features/gsc/services/GscService";
import { describeError } from "@/server/lib/errors";

// Days fetched per project per tick for followed phrases. Each day is its own
// Search Console request, limited to that one day, so a phrase's position is
// that day's alone, never an average across days.
const KEYWORD_DAYS_PER_TICK = 8;
// Every followed phrase in one request per day, through a query regex. Long
// lists are split so the pattern stays well inside Google's limits.
const MAX_PATTERN_LENGTH = 3000;
// The most pages Search Console returns in one request.
const ROW_LIMIT = 25_000;

type DayBatch = { date: string; keywords: GscTrackerKeyword[] };

/** An exact-match RE2 alternation for the given phrases. */
export function exactQueryPattern(queries: string[]): string {
  const escaped = queries.map((query) =>
    query.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&"),
  );
  return `^(?:${escaped.join("|")})$`;
}

/** Splits phrases into groups whose pattern fits the length limit. */
function patternGroups(keywords: GscTrackerKeyword[]): GscTrackerKeyword[][] {
  const groups: GscTrackerKeyword[][] = [];
  let current: GscTrackerKeyword[] = [];
  let length = 0;
  for (const keyword of keywords) {
    const added = keyword.query.length * 2 + 1;
    if (current.length > 0 && length + added > MAX_PATTERN_LENGTH) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(keyword);
    length += added;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * The days this tick fetches and which phrases each covers. Recent days come
 * first (oldest missing day first), then older history (newest first), so
 * every phrase's stored range stays contiguous whatever the budget cuts.
 */
export function planKeywordDays(
  keywords: GscTrackerKeyword[],
  now: Date,
  budget = KEYWORD_DAYS_PER_TICK,
): { forward: DayBatch[]; backward: DayBatch[] } {
  const forward = new Map<string, GscTrackerKeyword[]>();
  const backward = new Map<string, GscTrackerKeyword[]>();
  for (const keyword of keywords) {
    // The full need: Google keeps 16 months, about 490 days.
    const plan = planSyncDays(keyword, now, 1000);
    for (const date of plan.forward)
      forward.set(date, [...(forward.get(date) ?? []), keyword]);
    for (const date of plan.backward)
      backward.set(date, [...(backward.get(date) ?? []), keyword]);
  }
  const forwardDays = [...forward.keys()];
  forwardDays.sort();
  const backwardDays = [...backward.keys()];
  backwardDays.sort();
  backwardDays.reverse();
  const pickedForward = forwardDays.slice(0, budget);
  const pickedBackward = backwardDays.slice(
    0,
    Math.max(0, budget - pickedForward.length),
  );
  return {
    forward: pickedForward.map((date) => ({
      date,
      keywords: forward.get(date) ?? [],
    })),
    backward: pickedBackward.map((date) => ({
      date,
      keywords: backward.get(date) ?? [],
    })),
  };
}

async function fetchDay(projectId: string, batch: DayBatch) {
  for (const group of patternGroups(batch.keywords)) {
    const byQuery = new Map(group.map((keyword) => [keyword.query, keyword]));
    const { rows } = await GscService.getPerformance({
      projectId,
      startDate: batch.date,
      endDate: batch.date,
      dimensions: ["query", "page"],
      regexFilters: [
        {
          dimension: "query",
          expression: exactQueryPattern(group.map((keyword) => keyword.query)),
        },
      ],
      rowLimit: ROW_LIMIT,
    });
    await GscTrackerKeywordRepository.replaceDay({
      projectId,
      keywordIds: group.map((keyword) => keyword.id),
      date: batch.date,
      rows: rows.flatMap((row) => {
        const [query, page] = row.keys ?? [];
        const keyword = query ? byQuery.get(query) : undefined;
        if (!keyword || !page) return [];
        return [
          {
            keywordId: keyword.id,
            page,
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.position,
          },
        ];
      }),
    });
  }
}

/** Extends each phrase's stored range by the days fetched for it. */
async function recordProgress(
  keywords: GscTrackerKeyword[],
  forward: DayBatch[],
  backward: DayBatch[],
  now: Date,
) {
  const latest = gscTrackerLatestDay(now);
  for (const keyword of keywords) {
    const ahead = forward
      .filter((batch) => batch.keywords.includes(keyword))
      .map((batch) => batch.date);
    const behind = backward
      .filter((batch) => batch.keywords.includes(keyword))
      .map((batch) => batch.date);
    if (ahead.length === 0 && behind.length === 0) continue;
    const dates = [...ahead, ...behind];
    dates.sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    await GscTrackerKeywordRepository.updateRange(keyword.id, {
      oldestDate:
        keyword.oldestDate && keyword.oldestDate < first
          ? keyword.oldestDate
          : first,
      newestDate:
        keyword.newestDate && keyword.newestDate > last
          ? keyword.newestDate
          : last,
      ...(ahead.includes(latest) ? { lastSyncedAt: now.toISOString() } : {}),
    });
  }
}

/** Fetches one batch of days for a project's followed phrases. */
export async function syncKeywords(
  tracker: GscTrackerProject,
  now = new Date(),
): Promise<void> {
  const keywords = await GscTrackerKeywordRepository.list(tracker.projectId);
  if (keywords.length === 0) return;
  const { forward, backward } = planKeywordDays(keywords, now);
  if (forward.length === 0 && backward.length === 0) return;
  try {
    for (const batch of [...forward, ...backward])
      await fetchDay(tracker.projectId, batch);
  } catch (error) {
    await GscTrackerRepository.update(tracker.projectId, {
      lastError: syncErrorMessage(error),
    });
    console.error("[gsc-tracker] keyword sync failed", {
      projectId: tracker.projectId,
      error: describeError(error),
    });
    return;
  }
  await recordProgress(keywords, forward, backward, now);
}
