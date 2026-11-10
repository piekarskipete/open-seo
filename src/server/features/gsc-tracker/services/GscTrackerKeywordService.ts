import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { GscTrackerRepository } from "../repositories/GscTrackerRepository";
import {
  addDays,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { syncKeywords } from "./gscTrackerKeywordSync";
import { keywordProgress } from "./gscTrackerKeywordProgress";
import { GscTrackerTagService } from "./GscTrackerTagService";
import { comparableUrl, normalizeQuery } from "@/shared/gsc-tracker";

// Followed phrases per project. Each costs a share of one Search Console
// request per day, so the cap is about keeping the page readable.
const MAX_KEYWORDS = 1000;

type DayMetrics = { position: number; clicks: number; impressions: number };

/** The months that hold stored days: Google's 16 months up to the latest day. */
function availableMonths(now: Date): string[] {
  const first = gscTrackerFloor(now).slice(0, 7);
  const last = gscTrackerLatestDay(now).slice(0, 7);
  const months: string[] = [];
  for (let month = last; month >= first; ) {
    months.push(month);
    month = addDays(`${month}-01`, -1).slice(0, 7);
  }
  return months;
}

/** The month's days, up to the newest day Search Console has. */
function monthDays(month: string, now: Date): string[] {
  const latest = gscTrackerLatestDay(now);
  const days: string[] = [];
  for (
    let day = `${month}-01`;
    day.startsWith(month) && day <= latest;
    day = addDays(day, 1)
  )
    days.push(day);
  return days;
}

/**
 * The month for every followed phrase: its target URL's position day by day,
 * and every page Search Console showed for it, with the ones beating the
 * target marked. A page beats the target when it earns more clicks or more
 * impressions over the month; a day is flagged when another page beat the
 * target that day.
 */
async function getMonth(siteId: string, month: string, now = new Date()) {
  const months = availableMonths(now);
  const selected = months.includes(month) ? month : months[0];
  const days = monthDays(selected, now);
  const monthStart = `${selected}-01`;
  // From the previous month's start, for "last month" and the move into
  // this month's first measured day.
  const [keywords, rows, tagIds] = await Promise.all([
    GscTrackerKeywordRepository.list(siteId),
    days.length > 0
      ? GscTrackerKeywordRepository.listDays({
          siteId,
          from: `${addDays(monthStart, -1).slice(0, 7)}-01`,
          to: days[days.length - 1],
        })
      : Promise.resolve([]),
    GscTrackerTagService.tagsByKeyword(siteId),
  ]);

  const entries = await Promise.all(
    keywords.map(async (keyword) => {
      const own = rows.filter((row) => row.keywordId === keyword.id);
      const progress = await keywordProgress({
        keyword,
        rows: own,
        monthStart,
      });
      return { keyword, own, progress };
    }),
  );

  return {
    month: selected,
    months,
    days,
    keywords: entries.map(({ keyword, own, progress }) => {
      const target = comparableUrl(keyword.targetUrl);
      const pages = new Map<string, Record<string, DayMetrics>>();
      for (const row of own) {
        if (row.date < monthStart) continue;
        const pageDays = pages.get(row.page) ?? {};
        pageDays[row.date] = {
          position: row.position,
          clicks: row.clicks,
          impressions: row.impressions,
        };
        pages.set(row.page, pageDays);
      }
      const summarized = [...pages].map(([url, byDay]) => {
        const values = Object.values(byDay);
        const impressions = values.reduce(
          (sum, day) => sum + day.impressions,
          0,
        );
        const weight = values.reduce(
          (sum, day) => sum + day.position * day.impressions,
          0,
        );
        return {
          url,
          isTarget: comparableUrl(url) === target,
          clicks: values.reduce((sum, day) => sum + day.clicks, 0),
          impressions,
          position: impressions > 0 ? weight / impressions : null,
          days: byDay,
        };
      });
      const targetPage = summarized.find((page) => page.isTarget);
      const ranked = summarized.map((page) => ({
        ...page,
        stronger:
          !page.isTarget &&
          (page.clicks > (targetPage?.clicks ?? 0) ||
            page.impressions > (targetPage?.impressions ?? 0)),
      }));
      ranked.sort(
        (a, b) =>
          Number(b.isTarget) - Number(a.isTarget) ||
          b.impressions - a.impressions,
      );
      const outrankedDays = days.filter((date) => {
        const mine = targetPage?.days[date];
        return ranked.some((page) => {
          const theirs = page.days[date];
          if (page.isTarget || !theirs) return false;
          return (
            theirs.clicks > (mine?.clicks ?? 0) ||
            theirs.impressions > (mine?.impressions ?? 0)
          );
        });
      });
      return {
        id: keyword.id,
        query: keyword.query,
        targetUrl: keyword.targetUrl,
        oldestDate: keyword.oldestDate,
        newestDate: keyword.newestDate,
        cannibalized: ranked.some((page) => page.stronger),
        competingPages: ranked.filter((page) => page.stronger).length,
        tagIds: tagIds.get(keyword.id) ?? [],
        checkpoints: [keyword.checkpoint1Date, keyword.checkpoint2Date].filter(
          (date): date is string => date !== null,
        ),
        outrankedDays,
        pages: ranked,
        ...progress,
      };
    }),
  };
}

/** Follows phrase/URL pairs and fetches their recent days right away. The
 *  same phrase can be followed for several URLs, each its own entry; a pair
 *  already followed (same phrase, same page) is skipped. */
async function add(
  siteId: string,
  entries: { query: string; targetUrl: string }[],
) {
  const tracker = await GscTrackerRepository.get(siteId);
  if (!tracker) throw new AppError("NOT_FOUND", "Tracking is off.");
  const existing = await GscTrackerKeywordRepository.list(siteId);
  const pairKey = (query: string, url: string) =>
    `${query}\n${comparableUrl(url)}`;
  const known = new Set(
    existing.map((keyword) => pairKey(keyword.query, keyword.targetUrl)),
  );
  const fresh = new Map<string, { query: string; targetUrl: string }>();
  for (const entry of entries) {
    const query = normalizeQuery(entry.query);
    const targetUrl = entry.targetUrl.trim();
    const key = pairKey(query, targetUrl);
    if (query && !known.has(key)) fresh.set(key, { query, targetUrl });
  }
  if (existing.length + fresh.size > MAX_KEYWORDS)
    throw new AppError(
      "VALIDATION_ERROR",
      `A site can follow up to ${MAX_KEYWORDS} phrases.`,
    );
  await GscTrackerKeywordRepository.upsertMany(tracker, [...fresh.values()]);
  await syncKeywords(tracker);
  return { added: fresh.size, skipped: entries.length - fresh.size };
}

/** Every followed phrase with its target, to show which pages are tracked. */
async function listTargets(siteId: string) {
  const keywords = await GscTrackerKeywordRepository.list(siteId);
  return keywords.map((keyword) => ({
    query: keyword.query,
    targetUrl: keyword.targetUrl,
  }));
}

/** Sets the day a phrase's progress is measured from; null goes back to
 *  the day it was added. */
async function setStartDate(input: {
  siteId: string;
  ids: string[];
  startDate: string | null;
}) {
  await GscTrackerKeywordRepository.setStartDate({
    ...input,
    ids: [...new Set(input.ids)],
  });
}

/** Replaces the checkpoints (up to two days) of several phrases. */
async function setCheckpoints(input: {
  siteId: string;
  ids: string[];
  checkpoints: string[];
}) {
  const days = [...new Set(input.checkpoints)];
  if (days.length === 2 && (days[1] ?? "") < (days[0] ?? "")) days.reverse();
  if (days.length > 2)
    throw new AppError(
      "VALIDATION_ERROR",
      "A phrase takes up to two checkpoints.",
    );
  await GscTrackerKeywordRepository.setCheckpoints({
    siteId: input.siteId,
    ids: [...new Set(input.ids)],
    checkpoints: [days[0] ?? null, days[1] ?? null],
  });
}

async function remove(siteId: string, id: string) {
  await GscTrackerKeywordRepository.remove(siteId, id);
}

export const GscTrackerKeywordService = {
  getMonth,
  add,
  listTargets,
  setStartDate,
  setCheckpoints,
  remove,
};
