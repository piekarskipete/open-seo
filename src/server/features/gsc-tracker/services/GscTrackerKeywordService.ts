import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { GscTrackerRepository } from "../repositories/GscTrackerRepository";
import {
  addDays,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { syncKeywords } from "./gscTrackerKeywordSync";
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
async function getMonth(projectId: string, month: string, now = new Date()) {
  const months = availableMonths(now);
  const selected = months.includes(month) ? month : months[0];
  const days = monthDays(selected, now);
  const [keywords, rows] = await Promise.all([
    GscTrackerKeywordRepository.list(projectId),
    days.length > 0
      ? GscTrackerKeywordRepository.listDays({
          projectId,
          from: days[0],
          to: days[days.length - 1],
        })
      : Promise.resolve([]),
  ]);

  return {
    month: selected,
    months,
    days,
    keywords: keywords.map((keyword) => {
      const target = comparableUrl(keyword.targetUrl);
      const pages = new Map<string, Record<string, DayMetrics>>();
      for (const row of rows) {
        if (row.keywordId !== keyword.id) continue;
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
        outrankedDays,
        pages: ranked,
      };
    }),
  };
}

/** Follows phrases (or retargets ones already followed) and fetches their
 *  recent days right away. */
async function add(
  projectId: string,
  entries: { query: string; targetUrl: string }[],
) {
  const tracker = await GscTrackerRepository.get(projectId);
  if (!tracker) throw new AppError("NOT_FOUND", "Tracking is off.");
  const unique = new Map<string, string>();
  for (const entry of entries) {
    const query = normalizeQuery(entry.query);
    if (query) unique.set(query, entry.targetUrl.trim());
  }
  const existing = await GscTrackerKeywordRepository.list(projectId);
  const known = new Set(existing.map((keyword) => keyword.query));
  const added = [...unique.keys()].filter((query) => !known.has(query)).length;
  if (existing.length + added > MAX_KEYWORDS)
    throw new AppError(
      "VALIDATION_ERROR",
      `A project can follow up to ${MAX_KEYWORDS} phrases.`,
    );
  await GscTrackerKeywordRepository.upsertMany(
    projectId,
    [...unique].map(([query, targetUrl]) => ({ query, targetUrl })),
  );
  await syncKeywords(tracker);
  return { added, updated: unique.size - added };
}

/** Every followed phrase with its target, to show which pages are tracked. */
async function listTargets(projectId: string) {
  const keywords = await GscTrackerKeywordRepository.list(projectId);
  return keywords.map((keyword) => ({
    query: keyword.query,
    targetUrl: keyword.targetUrl,
  }));
}

async function remove(projectId: string, id: string) {
  await GscTrackerKeywordRepository.remove(projectId, id);
}

export const GscTrackerKeywordService = {
  getMonth,
  add,
  listTargets,
  remove,
};
