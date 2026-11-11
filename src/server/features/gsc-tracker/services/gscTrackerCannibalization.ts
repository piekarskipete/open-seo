import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
} from "@/db/schema";
import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import { compileGroupRegex } from "./gscTrackerGroupRules";
import { metrics, periods } from "./gscTrackerWindows";
import { AppError } from "@/server/lib/errors";
import {
  parseCannibalExclusions,
  type GscTrackerExclusion,
} from "@/shared/gsc-tracker";

// A query counts as cannibalized when a second page earns at least this share
// of its impressions, and the query has at least this many.
const CANNIBAL_MIN_SHARE = 0.1;
const CANNIBAL_MIN_IMPRESSIONS = 10;
const CANNIBAL_LIMIT = 200;

/** A test for the URLs the site's active exclusions leave out, such as
 *  tracking parameters ("?fbclid=") or a section. */
function excludedTest(
  exclusions: GscTrackerExclusion[],
): (url: string) => boolean {
  const tests = exclusions
    .filter((rule) => rule.active)
    .flatMap((rule): ((url: string) => boolean)[] => {
      if (rule.mode === "regex") {
        const regex = compileGroupRegex(rule.pattern);
        return regex ? [(url) => regex.test(url)] : [];
      }
      const text = rule.pattern.toLowerCase();
      return [(url) => url.toLowerCase().includes(text)];
    });
  return (url) => tests.some((test) => test(url));
}

/**
 * Queries where more than one page shares the impressions, leaving out the
 * URLs the site excludes. `search` narrows them by query text, `page` to
 * those where a competing page's URL contains it.
 */
async function getCannibalization(
  site: GscTrackerSite,
  days: number,
  filter: { search?: string; page?: string } = {},
) {
  const exclusions = parseCannibalExclusions(site.cannibalExclusions);
  const search = filter.search?.trim().toLowerCase();
  const urlText = filter.page?.trim().toLowerCase();
  const range = await periods(site.id, days);
  if (!range) return null;
  const isExcluded = excludedTest(exclusions);
  const r = gscTrackerRows;
  const inWindow = and(
    eq(r.siteId, site.id),
    gte(r.date, range.currentStart),
    lte(r.date, range.currentEnd),
  );
  const sharedQueries = db
    .select({ queryId: r.queryId })
    .from(r)
    .innerJoin(gscTrackerQueries, eq(gscTrackerQueries.id, r.queryId))
    .where(
      and(
        inWindow,
        search
          ? sql`lower(${gscTrackerQueries.query}) like ${`%${search}%`}`
          : undefined,
      ),
    )
    .groupBy(r.queryId)
    .having(sql`count(distinct ${r.pageId}) > 1`);
  const rows = await db
    .select({
      query: gscTrackerQueries.query,
      page: gscTrackerPages.url,
      clicks: sql<number>`sum(${r.clicks})`.mapWith(Number),
      impressions: sql<number>`sum(${r.impressions})`.mapWith(Number),
      weight: sql<number>`sum(${r.position} * ${r.impressions})`.mapWith(
        Number,
      ),
    })
    .from(r)
    .innerJoin(gscTrackerQueries, eq(gscTrackerQueries.id, r.queryId))
    .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, r.pageId))
    .where(and(inWindow, inArray(r.queryId, sharedQueries)))
    .groupBy(
      gscTrackerQueries.id,
      gscTrackerQueries.query,
      gscTrackerPages.id,
      gscTrackerPages.url,
    );

  // Excluded URLs don't count at all: a query split only with them isn't
  // cannibalized.
  const byQuery = new Map<string, typeof rows>();
  for (const row of rows) {
    if (isExcluded(row.page)) continue;
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }
  const queries = [];
  for (const [query, pages] of byQuery) {
    const impressions = pages.reduce(
      (total, item) => total + item.impressions,
      0,
    );
    if (impressions < CANNIBAL_MIN_IMPRESSIONS) continue;
    const ranked = pages.map((item) => ({
      url: item.page,
      share: item.impressions / impressions,
      ...metrics(item.clicks, item.impressions, item.weight),
    }));
    ranked.sort((a, b) => b.impressions - a.impressions);
    if ((ranked[1]?.share ?? 0) < CANNIBAL_MIN_SHARE) continue;
    if (
      urlText &&
      !ranked.some((item) => item.url.toLowerCase().includes(urlText))
    )
      continue;
    queries.push({
      query,
      impressions,
      clicks: pages.reduce((total, item) => total + item.clicks, 0),
      pages: ranked,
    });
  }
  queries.sort((a, b) => b.impressions - a.impressions);
  return {
    ...range,
    exclusions,
    queries: queries.slice(0, CANNIBAL_LIMIT),
  };
}

/** Replaces the site's URL exclusions, checking each regex. */
async function saveExclusions(
  site: GscTrackerSite,
  exclusions: GscTrackerExclusion[],
) {
  for (const rule of exclusions)
    if (rule.mode === "regex" && !compileGroupRegex(rule.pattern))
      throw new AppError(
        "VALIDATION_ERROR",
        `“${rule.pattern}” isn't a valid regular expression.`,
      );
  await GscTrackerRepository.update(site.id, {
    cannibalExclusions: JSON.stringify(exclusions),
  });
}

export const GscTrackerCannibalization = {
  getCannibalization,
  saveExclusions,
};
