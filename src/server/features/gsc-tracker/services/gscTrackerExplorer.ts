import { and, desc, eq, gte, lte, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import {
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
} from "@/db/schema";
import { metrics, periods } from "./gscTrackerWindows";

// Rows a list returns. The client filters and sorts within them.
const LIST_LIMIT = 1000;

/**
 * Sums of the current and previous windows per query. With `page`, only the
 * rows of pages whose URL contains it count, so the list shows every query a
 * page earns and that page's numbers for it.
 */
export async function compareQueries(input: {
  siteId: string;
  days: number;
  search?: string;
  page?: string;
}) {
  const range = await periods(input.siteId, input.days);
  if (!range) return null;
  const r = gscTrackerRows;
  const inCurrent = sql`${r.date} >= ${range.currentStart}`;
  const current = (value: SQLWrapper) =>
    sql<number>`sum(case when ${inCurrent} then ${value} else 0 end)`.mapWith(
      Number,
    );
  const previous = (value: SQLWrapper) =>
    sql<number>`sum(case when ${inCurrent} then 0 else ${value} end)`.mapWith(
      Number,
    );
  const weight = sql`${r.position} * ${r.impressions}`;
  const search = input.search?.trim().toLowerCase();
  const page = input.page?.trim().toLowerCase();

  const rows = await db
    .select({
      key: gscTrackerQueries.query,
      clicks: current(r.clicks),
      impressions: current(r.impressions),
      weight: current(weight),
      previousClicks: previous(r.clicks),
      previousImpressions: previous(r.impressions),
      previousWeight: previous(weight),
      queryId: gscTrackerQueries.id,
      urls: sql<number>`count(distinct case when ${inCurrent} then ${r.pageId} end)`.mapWith(
        Number,
      ),
    })
    .from(r)
    .innerJoin(gscTrackerQueries, eq(gscTrackerQueries.id, r.queryId))
    .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, r.pageId))
    .where(
      and(
        eq(r.siteId, input.siteId),
        gte(r.date, range.previousStart),
        lte(r.date, range.currentEnd),
        search
          ? sql`lower(${gscTrackerQueries.query}) like ${`%${search}%`}`
          : undefined,
        page
          ? sql`lower(${gscTrackerPages.url}) like ${`%${page}%`}`
          : undefined,
      ),
    )
    .groupBy(gscTrackerQueries.id, gscTrackerQueries.query)
    .orderBy(desc(sql`sum(${r.impressions})`))
    .limit(LIST_LIMIT);

  // Under a URL filter the rows only hold the matching pages; the URL count
  // stays site-wide, so count those queries' pages again without it.
  const siteUrls = page
    ? await countQueryUrls(input.siteId, range, page)
    : null;

  return {
    ...range,
    rows: rows.map((row) => ({
      key: row.key,
      urls: siteUrls ? (siteUrls.get(row.queryId) ?? 0) : row.urls,
      current: metrics(row.clicks, row.impressions, row.weight),
      previous: metrics(
        row.previousClicks,
        row.previousImpressions,
        row.previousWeight,
      ),
    })),
  };
}

/** Pages each query reached in the current period, for the queries that
 *  reached a page whose URL contains `page`. */
async function countQueryUrls(
  siteId: string,
  range: { currentStart: string; currentEnd: string },
  page: string,
): Promise<Map<number, number>> {
  const r = gscTrackerRows;
  const counts = await db
    .select({
      queryId: r.queryId,
      urls: sql<number>`count(distinct ${r.pageId})`.mapWith(Number),
    })
    .from(r)
    .where(
      and(
        eq(r.siteId, siteId),
        gte(r.date, range.currentStart),
        lte(r.date, range.currentEnd),
        sql`${r.queryId} in (
          select f.query_id from gsc_tracker_rows f
          join gsc_tracker_pages p on p.id = f.page_id
          where f.site_id = ${siteId}
            and f.date >= ${range.currentStart}
            and f.date <= ${range.currentEnd}
            and lower(p.url) like ${`%${page}%`}
        )`,
      ),
    )
    .groupBy(r.queryId);
  return new Map(counts.map((row) => [row.queryId, row.urls]));
}
