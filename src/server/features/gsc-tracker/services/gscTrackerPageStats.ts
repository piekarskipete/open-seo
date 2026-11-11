import {
  and,
  desc,
  eq,
  gte,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
  gscTrackerPageDays,
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
  gscTrackerUrlGroupMembers,
  gscTrackerUrlGroups,
} from "@/db/schema";
import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import { GscTrackerGroupRepository } from "../repositories/GscTrackerGroupRepository";
import { addDays } from "./gscTrackerDates";
import { compileGroupRegex } from "./gscTrackerGroupRules";
import { customPeriods, metrics } from "./gscTrackerWindows";
import { AppError } from "@/server/lib/errors";
import {
  comparableUrl,
  type GscTrackerUrlFilterMode,
} from "@/shared/gsc-tracker";

// Page numbers come from the per-page history (gsc_tracker_page_days), whose
// days include anonymized queries; a page's queries come from the query/page
// rows.

// Pages a list returns at most; the client pages and filters within them.
const PAGE_LIST_LIMIT = 5_000;
// Phrases one query filter takes, each a bound value.
const MAX_QUERY_PHRASES = 20;

type Range = {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
};

export type PageFilter = {
  urlMode?: GscTrackerUrlFilterMode;
  url?: string;
  /** Phrases, one per line: pages earning a query that contains any. */
  queries?: string;
};

/** The selected window ending at the newest stored page day, and the one
 *  before it. */
export function pagePeriods(site: GscTrackerSite, days: number): Range | null {
  if (!site.pagesNewestDate) return null;
  const currentEnd = site.pagesNewestDate;
  const currentStart = addDays(currentEnd, -(days - 1));
  return {
    currentStart,
    currentEnd,
    previousStart: addDays(currentStart, -days),
    previousEnd: addDays(currentStart, -1),
  };
}

/** Current and previous sums over page days, for a select list. */
function windowSums(range: Range) {
  const d = gscTrackerPageDays;
  const inCurrent = sql`${d.date} >= ${range.currentStart}`;
  const current = (value: SQLWrapper) =>
    sql<number>`sum(case when ${inCurrent} then ${value} else 0 end)`.mapWith(
      Number,
    );
  const previous = (value: SQLWrapper) =>
    sql<number>`sum(case when ${inCurrent} then 0 else ${value} end)`.mapWith(
      Number,
    );
  const weight = sql`${d.position} * ${d.impressions}`;
  return {
    clicks: current(d.clicks),
    impressions: current(d.impressions),
    weight: current(weight),
    previousClicks: previous(d.clicks),
    previousImpressions: previous(d.impressions),
    previousWeight: previous(weight),
  };
}

type Sums = {
  clicks: number;
  impressions: number;
  weight: number;
  previousClicks: number;
  previousImpressions: number;
  previousWeight: number;
};

function compare(sums: Sums | undefined) {
  return {
    current: metrics(
      sums?.clicks ?? 0,
      sums?.impressions ?? 0,
      sums?.weight ?? 0,
    ),
    previous: metrics(
      sums?.previousClicks ?? 0,
      sums?.previousImpressions ?? 0,
      sums?.previousWeight ?? 0,
    ),
  };
}

/** Pages earning a query that contains any of the phrases, in the window. */
function queryFilter(siteId: string, range: Range, text: string): SQL | null {
  const phrases = text
    .split(/\r?\n/)
    .map((phrase) => phrase.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_QUERY_PHRASES);
  if (phrases.length === 0) return null;
  const r = gscTrackerRows;
  const q = gscTrackerQueries;
  const anyPhrase = or(
    ...phrases.map((phrase) => sql`lower(${q.query}) like ${`%${phrase}%`}`),
  );
  return sql`${gscTrackerPages.id} in (
    select ${r.pageId} from ${r} join ${q} on ${q.id} = ${r.queryId}
    where ${r.siteId} = ${siteId}
      and ${r.date} >= ${range.currentStart}
      and ${r.date} <= ${range.currentEnd}
      and (${anyPhrase})
  )`;
}

/** The URL filter as a test on a page URL; a "contains" filter runs in SQL. */
function urlTest(filter: PageFilter): ((url: string) => boolean) | null {
  const text = filter.url?.trim();
  if (!text || filter.urlMode === "contains" || !filter.urlMode) return null;
  if (filter.urlMode === "regex") {
    const regex = compileGroupRegex(text);
    if (!regex)
      throw new AppError(
        "VALIDATION_ERROR",
        "That regular expression isn't valid.",
      );
    return (url) => regex.test(url);
  }
  const wanted = new Set(
    text
      .split(/[\r\n\s,]+/)
      .map((url) => url.trim())
      .filter(Boolean)
      .map(comparableUrl),
  );
  return (url) => wanted.has(comparableUrl(url));
}

/**
 * Pages with their current and previous numbers. In a group, every URL it
 * holds is listed, the ones without data with zeros; otherwise every page
 * with data in either window.
 */
export async function listPages(input: {
  site: GscTrackerSite;
  days: number;
  groupId?: string;
  filter?: PageFilter;
}) {
  const range = pagePeriods(input.site, input.days);
  if (!range) return null;
  const filter = input.filter ?? {};
  const contains =
    (filter.urlMode ?? "contains") === "contains" && filter.url?.trim()
      ? filter.url.trim().toLowerCase()
      : null;
  const byQuery = filter.queries
    ? queryFilter(input.site.id, range, filter.queries)
    : null;
  const m = gscTrackerUrlGroupMembers;
  const inGroup = input.groupId
    ? sql`${gscTrackerPages.url} in (
        select ${m.url} from ${m}
        where ${m.groupId} = ${input.groupId} and ${m.excluded} = 0
      )`
    : undefined;
  const rows = await db
    .select({ url: gscTrackerPages.url, ...windowSums(range) })
    .from(gscTrackerPageDays)
    .innerJoin(
      gscTrackerPages,
      eq(gscTrackerPages.id, gscTrackerPageDays.pageId),
    )
    .where(
      and(
        eq(gscTrackerPageDays.siteId, input.site.id),
        gte(gscTrackerPageDays.date, range.previousStart),
        lte(gscTrackerPageDays.date, range.currentEnd),
        inGroup,
        contains
          ? sql`lower(${gscTrackerPages.url}) like ${`%${contains}%`}`
          : undefined,
        byQuery ?? undefined,
      ),
    )
    .groupBy(gscTrackerPages.id, gscTrackerPages.url)
    .orderBy(desc(sql`sum(${gscTrackerPageDays.impressions})`));

  const test = urlTest(filter);
  const keep = (url: string) =>
    (!test || test(url)) && (!contains || url.toLowerCase().includes(contains));
  const listed = rows
    .filter((row) => keep(row.url))
    .map((row) => ({ key: row.url, ...compare(row) }));
  // A group's URLs without any data yet (fresh from a sitemap, say).
  if (input.groupId && !byQuery) {
    const seen = new Set(listed.map((row) => row.key));
    for (const member of await GscTrackerGroupRepository.listMembers(
      input.groupId,
    ))
      if (!member.excluded && !seen.has(member.url) && keep(member.url))
        listed.push({ key: member.url, ...compare(undefined) });
  }
  return {
    ...range,
    truncated: listed.length > PAGE_LIST_LIMIT,
    rows: listed.slice(0, PAGE_LIST_LIMIT),
  };
}

/** Each group's totals over its URLs, current and previous window. */
export async function groupTotals(site: GscTrackerSite, range: Range) {
  const m = gscTrackerUrlGroupMembers;
  const rows = await db
    .select({ groupId: m.groupId, ...windowSums(range) })
    .from(m)
    .innerJoin(gscTrackerUrlGroups, eq(gscTrackerUrlGroups.id, m.groupId))
    .innerJoin(
      gscTrackerPages,
      and(eq(gscTrackerPages.siteId, site.id), eq(gscTrackerPages.url, m.url)),
    )
    .innerJoin(
      gscTrackerPageDays,
      eq(gscTrackerPageDays.pageId, gscTrackerPages.id),
    )
    .where(
      and(
        eq(gscTrackerUrlGroups.siteId, site.id),
        eq(m.excluded, 0),
        gte(gscTrackerPageDays.date, range.previousStart),
        lte(gscTrackerPageDays.date, range.currentEnd),
      ),
    )
    .groupBy(m.groupId);
  return new Map(rows.map((row) => [row.groupId, compare(row)]));
}

/** A group's (or the whole site's) daily totals over the current window. */
export async function dailySeries(
  site: GscTrackerSite,
  range: Pick<Range, "currentStart" | "currentEnd">,
  scope: { groupId?: string; url?: string },
) {
  const d = gscTrackerPageDays;
  const m = gscTrackerUrlGroupMembers;
  const rows = await db
    .select({
      date: d.date,
      clicks: sql<number>`sum(${d.clicks})`.mapWith(Number),
      impressions: sql<number>`sum(${d.impressions})`.mapWith(Number),
      weight: sql<number>`sum(${d.position} * ${d.impressions})`.mapWith(
        Number,
      ),
    })
    .from(d)
    .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, d.pageId))
    .where(
      and(
        eq(d.siteId, site.id),
        gte(d.date, range.currentStart),
        lte(d.date, range.currentEnd),
        scope.groupId
          ? sql`${gscTrackerPages.url} in (
              select ${m.url} from ${m}
              where ${m.groupId} = ${scope.groupId} and ${m.excluded} = 0
            )`
          : undefined,
        scope.url ? eq(gscTrackerPages.url, scope.url) : undefined,
      ),
    )
    .groupBy(d.date)
    .orderBy(d.date);
  return rows.map((row) => ({
    date: row.date,
    ...metrics(row.clicks, row.impressions, row.weight),
  }));
}

/** One page over a window: its daily numbers and the queries it earns. */
export async function pageDetail(input: {
  site: GscTrackerSite;
  url: string;
  days?: number;
  from?: string;
  to?: string;
}) {
  const range =
    input.from && input.to
      ? customPeriods(input.from, input.to)
      : pagePeriods(input.site, input.days ?? 28);
  if (!range) return null;
  const r = gscTrackerRows;
  const inCurrent = sql`${r.date} >= ${range.currentStart}`;
  const sum = (value: SQLWrapper, current: boolean) =>
    sql<number>`sum(case when ${inCurrent} then ${current ? value : 0} else ${current ? 0 : value} end)`.mapWith(
      Number,
    );
  const weight = sql`${r.position} * ${r.impressions}`;
  const [series, totals, queries] = await Promise.all([
    dailySeries(input.site, range, { url: input.url }),
    db
      .select(windowSums(range))
      .from(gscTrackerPageDays)
      .innerJoin(
        gscTrackerPages,
        eq(gscTrackerPages.id, gscTrackerPageDays.pageId),
      )
      .where(
        and(
          eq(gscTrackerPageDays.siteId, input.site.id),
          eq(gscTrackerPages.url, input.url),
          gte(gscTrackerPageDays.date, range.previousStart),
          lte(gscTrackerPageDays.date, range.currentEnd),
        ),
      ),
    db
      .select({
        query: gscTrackerQueries.query,
        clicks: sum(r.clicks, true),
        impressions: sum(r.impressions, true),
        weight: sum(weight, true),
        previousClicks: sum(r.clicks, false),
        previousImpressions: sum(r.impressions, false),
        previousWeight: sum(weight, false),
      })
      .from(r)
      .innerJoin(gscTrackerQueries, eq(gscTrackerQueries.id, r.queryId))
      .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, r.pageId))
      .where(
        and(
          eq(r.siteId, input.site.id),
          eq(gscTrackerPages.url, input.url),
          gte(r.date, range.previousStart),
          lte(r.date, range.currentEnd),
        ),
      )
      .groupBy(gscTrackerQueries.id, gscTrackerQueries.query)
      .orderBy(desc(sql`sum(${r.impressions})`))
      .limit(PAGE_LIST_LIMIT),
  ]);
  return {
    ...range,
    series,
    totals: compare(totals[0]),
    queries: queries.map((row) => ({ key: row.query, ...compare(row) })),
  };
}
