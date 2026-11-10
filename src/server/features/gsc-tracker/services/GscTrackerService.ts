import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
  gscTrackerTotals,
} from "@/db/schema";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { GscService } from "@/server/features/gsc/services/GscService";
import { AppError } from "@/server/lib/errors";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { GscTrackerRepository } from "../repositories/GscTrackerRepository";
import {
  addDays,
  daysBetween,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { syncTracker } from "./GscTrackerSyncService";
import { syncKeywords } from "./gscTrackerKeywordSync";
import type { GscTrackerPositionFormat } from "@/shared/gsc-tracker";

/**
 * GSC Tracker: keeps a project's Search Console history in OpenSEO and reads
 * trends from it. Self-hosting only for now: storing Google data beyond the
 * dashboard's short cache is a privacy-policy decision for the hosted service.
 */

// Rows a list returns. The client filters and sorts within them.
const LIST_LIMIT = 1000;
// A query counts as cannibalized when a second page earns at least this share
// of its impressions, and the query has at least this many.
const CANNIBAL_MIN_SHARE = 0.1;
const CANNIBAL_MIN_IMPRESSIONS = 10;
const CANNIBAL_LIMIT = 200;

export type GscTrackerMetrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

function metrics(
  clicks: number,
  impressions: number,
  positionWeight: number,
): GscTrackerMetrics {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? positionWeight / impressions : null,
  };
}

/** Self-hosted deployments that hold their own Google access. Behind the
 *  Every App gateway Google calls are made per request, not from the cron. */
async function isAvailable(): Promise<boolean> {
  if (await isHostedServerAuthMode()) return false;
  return (await getGoogleAccessMode()) !== "gateway";
}

async function requireAvailable() {
  if (!(await isAvailable()))
    throw new AppError(
      "FORBIDDEN",
      "GSC Tracker is available on self-hosted OpenSEO.",
    );
}

async function getStatus(projectId: string) {
  const [available, tracker, connection] = await Promise.all([
    isAvailable(),
    GscTrackerRepository.get(projectId),
    GscService.getConnection(projectId),
  ]);
  const now = new Date();
  const floor = gscTrackerFloor(now);
  const latest = gscTrackerLatestDay(now);
  const positionFormat: GscTrackerPositionFormat =
    tracker?.positionFormat === "whole" ? "whole" : "decimal";
  const storedDays =
    tracker?.oldestDate && tracker.newestDate
      ? daysBetween(tracker.oldestDate, tracker.newestDate)
      : 0;
  return {
    available,
    connected: Boolean(connection),
    enabled: Boolean(tracker),
    siteUrl: tracker?.siteUrl ?? connection?.siteUrl ?? null,
    oldestDate: tracker?.oldestDate ?? null,
    newestDate: tracker?.newestDate ?? null,
    lastSyncedAt: tracker?.lastSyncedAt ?? null,
    lastError: tracker?.lastError ?? null,
    positionFormat,
    progress: Math.min(1, storedDays / daysBetween(floor, latest)),
  };
}

async function enable(input: {
  projectId: string;
  organizationId: string;
  userId: string;
}) {
  await requireAvailable();
  const connection = await GscService.getConnection(input.projectId);
  if (!connection)
    throw new AppError(
      "VALIDATION_ERROR",
      "Connect Search Console to this project first.",
    );
  const tracker = await GscTrackerRepository.create({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: connection.siteUrl,
    enabledByUserId: input.userId,
  });
  // The first batch runs now so the page has recent days right away; the cron
  // fetches the rest of the history.
  await syncTracker(tracker);
  await syncKeywords(tracker);
}

async function syncNow(projectId: string) {
  await requireAvailable();
  const tracker = await GscTrackerRepository.get(projectId);
  if (!tracker) throw new AppError("NOT_FOUND", "Tracking is off.");
  await syncTracker(tracker);
  await syncKeywords(tracker);
}

/** How the project shows positions: 7.4 or 7. */
async function setPositionFormat(
  projectId: string,
  positionFormat: GscTrackerPositionFormat,
) {
  const tracker = await GscTrackerRepository.get(projectId);
  if (!tracker) throw new AppError("NOT_FOUND", "Tracking is off.");
  await GscTrackerRepository.update(projectId, { positionFormat });
}

async function disable(projectId: string) {
  await GscTrackerRepository.remove(projectId);
}

/** The selected window ending at the newest stored day, and the one before. */
async function periods(projectId: string, days: number) {
  const tracker = await GscTrackerRepository.get(projectId);
  if (!tracker?.newestDate) return null;
  const currentEnd = tracker.newestDate;
  const currentStart = addDays(currentEnd, -(days - 1));
  const previousStart = addDays(currentStart, -days);
  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd: addDays(currentStart, -1),
  };
}

async function getOverview(projectId: string, days: number) {
  const range = await periods(projectId, days);
  if (!range) return null;
  const totals = await db
    .select({
      date: gscTrackerTotals.date,
      clicks: gscTrackerTotals.clicks,
      impressions: gscTrackerTotals.impressions,
      position: gscTrackerTotals.position,
    })
    .from(gscTrackerTotals)
    .where(
      and(
        eq(gscTrackerTotals.projectId, projectId),
        gte(gscTrackerTotals.date, range.previousStart),
        lte(gscTrackerTotals.date, range.currentEnd),
      ),
    )
    .orderBy(gscTrackerTotals.date);
  const sum = (from: string, to: string) => {
    let clicks = 0;
    let impressions = 0;
    let weight = 0;
    for (const day of totals) {
      if (day.date < from || day.date > to) continue;
      clicks += day.clicks;
      impressions += day.impressions;
      weight += day.position * day.impressions;
    }
    return metrics(clicks, impressions, weight);
  };
  return {
    ...range,
    current: sum(range.currentStart, range.currentEnd),
    previous: sum(range.previousStart, range.previousEnd),
    series: totals
      .filter((day) => day.date >= range.currentStart)
      .map((day) => ({
        date: day.date,
        clicks: day.clicks,
        impressions: day.impressions,
        ctr: day.impressions > 0 ? day.clicks / day.impressions : 0,
        position: day.position,
      })),
  };
}

/** Sums of the current and previous windows, per query or per page. */
async function compareBy(input: {
  projectId: string;
  days: number;
  dimension: "query" | "page";
  search?: string;
}) {
  const range = await periods(input.projectId, input.days);
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
  const keyTable =
    input.dimension === "query" ? gscTrackerQueries : gscTrackerPages;
  const keyColumn =
    input.dimension === "query" ? gscTrackerQueries.query : gscTrackerPages.url;
  const joinOn =
    input.dimension === "query"
      ? eq(gscTrackerQueries.id, r.queryId)
      : eq(gscTrackerPages.id, r.pageId);
  const search = input.search?.trim().toLowerCase();

  const rows = await db
    .select({
      key: keyColumn,
      clicks: current(r.clicks),
      impressions: current(r.impressions),
      weight: current(weight),
      previousClicks: previous(r.clicks),
      previousImpressions: previous(r.impressions),
      previousWeight: previous(weight),
    })
    .from(r)
    .innerJoin(keyTable, joinOn)
    .where(
      and(
        eq(r.projectId, input.projectId),
        gte(r.date, range.previousStart),
        lte(r.date, range.currentEnd),
        search ? sql`lower(${keyColumn}) like ${`%${search}%`}` : undefined,
      ),
    )
    .groupBy(keyTable.id, keyColumn)
    .orderBy(desc(sql`sum(${r.impressions})`))
    .limit(LIST_LIMIT);

  return {
    ...range,
    rows: rows.map((row) => ({
      key: row.key,
      current: metrics(row.clicks, row.impressions, row.weight),
      previous: metrics(
        row.previousClicks,
        row.previousImpressions,
        row.previousWeight,
      ),
    })),
  };
}

/** One query over the selected window: daily totals and the pages ranking. */
async function getQueryDetail(input: {
  projectId: string;
  query: string;
  days: number;
}) {
  const range = await periods(input.projectId, input.days);
  if (!range) return null;
  const rows = await db
    .select({
      date: gscTrackerRows.date,
      page: gscTrackerPages.url,
      clicks: gscTrackerRows.clicks,
      impressions: gscTrackerRows.impressions,
      position: gscTrackerRows.position,
    })
    .from(gscTrackerRows)
    .innerJoin(
      gscTrackerQueries,
      eq(gscTrackerQueries.id, gscTrackerRows.queryId),
    )
    .innerJoin(gscTrackerPages, eq(gscTrackerPages.id, gscTrackerRows.pageId))
    .where(
      and(
        eq(gscTrackerRows.projectId, input.projectId),
        eq(gscTrackerQueries.query, input.query),
        gte(gscTrackerRows.date, range.currentStart),
        lte(gscTrackerRows.date, range.currentEnd),
      ),
    )
    .orderBy(gscTrackerRows.date);

  const byDate = new Map<
    string,
    { clicks: number; impressions: number; weight: number }
  >();
  const byPage = new Map<
    string,
    { clicks: number; impressions: number; weight: number }
  >();
  for (const row of rows) {
    for (const [map, key] of [
      [byDate, row.date],
      [byPage, row.page],
    ] as const) {
      const entry = map.get(key) ?? { clicks: 0, impressions: 0, weight: 0 };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      entry.weight += row.position * row.impressions;
      map.set(key, entry);
    }
  }
  const pages = [...byPage].map(([url, page]) => ({
    url,
    ...metrics(page.clicks, page.impressions, page.weight),
  }));
  pages.sort((a, b) => b.impressions - a.impressions);
  return {
    ...range,
    series: [...byDate].map(([date, day]) => ({
      date,
      ...metrics(day.clicks, day.impressions, day.weight),
    })),
    pages,
  };
}

/** Queries where more than one page shares the impressions. */
async function getCannibalization(projectId: string, days: number) {
  const range = await periods(projectId, days);
  if (!range) return null;
  const r = gscTrackerRows;
  const inWindow = and(
    eq(r.projectId, projectId),
    gte(r.date, range.currentStart),
    lte(r.date, range.currentEnd),
  );
  const sharedQueries = db
    .select({ queryId: r.queryId })
    .from(r)
    .where(inWindow)
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

  const byQuery = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byQuery.get(row.query) ?? [];
    list.push(row);
    byQuery.set(row.query, list);
  }
  const queries = [];
  for (const [query, pages] of byQuery) {
    const impressions = pages.reduce(
      (total, page) => total + page.impressions,
      0,
    );
    if (impressions < CANNIBAL_MIN_IMPRESSIONS) continue;
    const ranked = pages.map((page) => ({
      url: page.page,
      share: page.impressions / impressions,
      ...metrics(page.clicks, page.impressions, page.weight),
    }));
    ranked.sort((a, b) => b.impressions - a.impressions);
    if ((ranked[1]?.share ?? 0) < CANNIBAL_MIN_SHARE) continue;
    queries.push({
      query,
      impressions,
      clicks: pages.reduce((total, page) => total + page.clicks, 0),
      pages: ranked,
    });
  }
  queries.sort((a, b) => b.impressions - a.impressions);
  return { ...range, queries: queries.slice(0, CANNIBAL_LIMIT) };
}

export const GscTrackerService = {
  isAvailable,
  getStatus,
  enable,
  syncNow,
  setPositionFormat,
  disable,
  getOverview,
  compareBy,
  getQueryDetail,
  getCannibalization,
};
