import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE } from "@/db/runBatch";
import {
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
} from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { GscTrackerKeywordService } from "./GscTrackerKeywordService";
import { GscTrackerTagService } from "./GscTrackerTagService";
import { periods } from "./gscTrackerWindows";
import { comparableUrl, normalizeQuery } from "@/shared/gsc-tracker";

/** A phrase and its target URL, as the tracker tells entries apart. */
const pairKey = (query: string, url: string) =>
  `${query}
${comparableUrl(url)}`;

// Queries per lookup, leaving room for the other bound values.
const QUERIES_PER_LOOKUP = DB_BATCH_SIZE - 10;

/**
 * Each query's page in the period: the one with the most clicks, then the
 * most impressions. With `page`, only pages whose URL contains it count.
 */
async function topPages(input: {
  siteId: string;
  queries: string[];
  from: string;
  to: string;
  page?: string;
}): Promise<Map<string, string>> {
  const best = new Map<
    string,
    { url: string; clicks: number; impressions: number }
  >();
  const page = input.page?.trim().toLowerCase();
  for (let i = 0; i < input.queries.length; i += QUERIES_PER_LOOKUP) {
    const part = input.queries.slice(i, i + QUERIES_PER_LOOKUP);
    const rows = await db
      .select({
        query: gscTrackerQueries.query,
        url: gscTrackerPages.url,
        clicks: sql<number>`sum(${gscTrackerRows.clicks})`.mapWith(Number),
        impressions: sql<number>`sum(${gscTrackerRows.impressions})`.mapWith(
          Number,
        ),
      })
      .from(gscTrackerRows)
      .innerJoin(
        gscTrackerQueries,
        eq(gscTrackerQueries.id, gscTrackerRows.queryId),
      )
      .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, gscTrackerRows.pageId))
      .where(
        and(
          eq(gscTrackerRows.siteId, input.siteId),
          gte(gscTrackerRows.date, input.from),
          lte(gscTrackerRows.date, input.to),
          inArray(gscTrackerQueries.query, part),
          page
            ? sql`lower(${gscTrackerPages.url}) like ${`%${page}%`}`
            : undefined,
        ),
      )
      .groupBy(gscTrackerQueries.query, gscTrackerPages.url);
    for (const row of rows) {
      const current = best.get(row.query);
      if (
        !current ||
        row.clicks > current.clicks ||
        (row.clicks === current.clicks && row.impressions > current.impressions)
      )
        best.set(row.query, row);
    }
  }
  return new Map([...best].map(([query, row]) => [query, row.url]));
}

/**
 * Follows Query Explorer queries in the tracker, each with its top page in
 * the period as the target URL, and sets their tags, start date and
 * checkpoints right away.
 */
export async function trackQueries(input: {
  siteId: string;
  queries: string[];
  days: number;
  page?: string;
  tags?: string[];
  /** A start date for all of them (null: the day each was added). */
  startDate?: string | null;
  /** Up to two checkpoint days for all of them. */
  checkpoints?: string[];
}) {
  const range = await periods(input.siteId, input.days);
  if (!range) throw new AppError("NOT_FOUND", "Tracking is off.");
  const queries = [...new Set(input.queries.map(normalizeQuery))].filter(
    Boolean,
  );
  const pages = await topPages({
    siteId: input.siteId,
    queries,
    from: range.currentStart,
    to: range.currentEnd,
    page: input.page,
  });
  const entries = queries.flatMap((query) => {
    const targetUrl = pages.get(query);
    return targetUrl ? [{ query, targetUrl }] : [];
  });
  const result =
    entries.length > 0
      ? await GscTrackerKeywordService.add(input.siteId, entries)
      : { added: 0, skipped: 0 };

  // Tags, start date and checkpoints go on every selected phrase, new or
  // already followed.
  const wantsExtras =
    (input.tags?.length ?? 0) > 0 ||
    input.startDate !== undefined ||
    input.checkpoints !== undefined;
  let keywordIds: string[] = [];
  if (entries.length > 0 && wantsExtras) {
    const wanted = new Set(
      entries.map((entry) => pairKey(entry.query, entry.targetUrl)),
    );
    keywordIds = (await GscTrackerKeywordRepository.list(input.siteId))
      .filter((keyword) =>
        wanted.has(pairKey(keyword.query, keyword.targetUrl)),
      )
      .map((keyword) => keyword.id);
  }
  if (keywordIds.length > 0) {
    if (input.tags && input.tags.length > 0)
      await GscTrackerTagService.applyToKeywords({
        siteId: input.siteId,
        keywordIds,
        addTags: input.tags,
      });
    if (input.startDate !== undefined)
      await GscTrackerKeywordService.setStartDate({
        siteId: input.siteId,
        ids: keywordIds,
        startDate: input.startDate,
      });
    if (input.checkpoints !== undefined)
      await GscTrackerKeywordService.setCheckpoints({
        siteId: input.siteId,
        ids: keywordIds,
        checkpoints: input.checkpoints,
      });
  }
  return {
    added: result.added,
    alreadyFollowed: result.skipped,
    // Queries with no page in the period (or none matching the URL filter).
    withoutPage: queries.length - entries.length,
    updated: keywordIds.length,
  };
}
