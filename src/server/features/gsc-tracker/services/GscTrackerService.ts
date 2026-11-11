import { and, eq, gte, lte } from "drizzle-orm";
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
import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import {
  daysBetween,
  gscTrackerFloor,
  gscTrackerLatestDay,
} from "./gscTrackerDates";
import { syncPagesAndGroups, syncTracker } from "./GscTrackerSyncService";
import { customPeriods, metrics, periods } from "./gscTrackerWindows";
import { compareQueries } from "./gscTrackerExplorer";
import { syncKeywords } from "./gscTrackerKeywordSync";
import {
  GSC_TRACKER_SORT_KEYS,
  parseOverviewLayout,
  type GscTrackerDateFormat,
  type GscTrackerPositionFormat,
  type GscTrackerSortKey,
  type GscTrackerWidget,
} from "@/shared/gsc-tracker";

/**
 * GSC Tracker: keeps a project's Search Console history in OpenSEO and reads
 * trends from it. Self-hosting only for now: storing Google data beyond the
 * dashboard's short cache is a privacy-policy decision for the hosted service.
 */

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

/** How far a site's history reaches, and its display settings. */
function siteState(site: GscTrackerSite, now = new Date()) {
  const floor = gscTrackerFloor(now);
  const latest = gscTrackerLatestDay(now);
  const storedDays =
    site.oldestDate && site.newestDate
      ? daysBetween(site.oldestDate, site.newestDate)
      : 0;
  const positionFormat: GscTrackerPositionFormat =
    site.positionFormat === "whole" ? "whole" : "decimal";
  const explorerSort: GscTrackerSortKey =
    GSC_TRACKER_SORT_KEYS.find((key) => key === site.explorerSort) ?? "clicks";
  const dateFormat: GscTrackerDateFormat =
    site.dateFormat === "mon-d" ? "mon-d" : "dd.mm";
  return {
    id: site.id,
    siteUrl: site.siteUrl,
    accountEmail: site.connectedAccountEmail,
    usesProjectConnection: site.connectedByUserId === null,
    oldestDate: site.oldestDate,
    newestDate: site.newestDate,
    lastSyncedAt: site.lastSyncedAt,
    lastError: site.lastError,
    positionFormat,
    explorerSort,
    dateFormat,
    overviewLayout: parseOverviewLayout(site.overviewLayout),
    progress: Math.min(1, storedDays / daysBetween(floor, latest)),
  };
}

/** Whether the tracker can run here, and the project's own connection,
 *  which a project's first site can use. */
async function getAvailability(projectId: string) {
  const [available, connection] = await Promise.all([
    isAvailable(),
    GscService.getConnection(projectId),
  ]);
  return {
    available,
    connected: Boolean(connection),
    projectSiteUrl: connection?.siteUrl ?? null,
  };
}

/** A site of the project; NOT_FOUND when it belongs elsewhere or is gone. */
async function requireSite(projectId: string, siteId: string) {
  const site = await GscTrackerRepository.getForProject(projectId, siteId);
  if (!site) throw new AppError("NOT_FOUND", "That site isn't tracked here.");
  return site;
}

/** One site's state for its page. */
async function getStatus(site: GscTrackerSite) {
  return siteState(site);
}

/** The project's sites with the last 28 days against the 28 before, for
 *  the site list. */
async function listSites(projectId: string) {
  const sites = await GscTrackerRepository.listForProject(projectId);
  return Promise.all(
    sites.map(async (site) => {
      const [overview, keywords] = await Promise.all([
        getOverview(site.id, 28),
        GscTrackerKeywordRepository.list(site.id),
      ]);
      return {
        ...siteState(site),
        phrases: keywords.length,
        current: overview?.current ?? null,
        previous: overview?.previous ?? null,
      };
    }),
  );
}

/**
 * Starts tracking a property. With `accountId`, through that Google account
 * or service account of the member (checked against the properties it can
 * reach); without, through the project's Search Console connection.
 */
async function addSite(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  siteUrl?: string;
  accountId?: string;
}) {
  await requireAvailable();
  let access: {
    siteUrl: string;
    gscAccountId: string | null;
    serviceAccountId: string | null;
    connectedByUserId: string | null;
    connectedAccountEmail: string | null;
  };
  if (input.accountId) {
    const { accounts } = await GscService.listSitesForUserWithGrantStatus({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const account = accounts.find((item) => item.accountId === input.accountId);
    const property = account?.sites.find(
      (site) => site.siteUrl === input.siteUrl,
    );
    if (!account || !property)
      throw new AppError(
        "NOT_FOUND",
        "That Search Console property isn't available on the chosen account.",
      );
    if (property.permissionLevel === "siteUnverifiedUser")
      throw new AppError(
        "FORBIDDEN",
        "The chosen account doesn't have verified access to that property.",
      );
    access = {
      siteUrl: property.siteUrl,
      gscAccountId: account.accountId,
      serviceAccountId:
        account.kind === "service_account" ? account.accountId : null,
      connectedByUserId: input.userId,
      connectedAccountEmail: account.email,
    };
  } else {
    const connection = await GscService.getConnection(input.projectId);
    if (!connection)
      throw new AppError(
        "VALIDATION_ERROR",
        "Connect Search Console to this project first, or pick an account.",
      );
    access = {
      siteUrl: connection.siteUrl,
      gscAccountId: null,
      serviceAccountId: null,
      connectedByUserId: null,
      connectedAccountEmail: connection.connectedAccountEmail,
    };
  }
  const site = await GscTrackerRepository.create({
    projectId: input.projectId,
    organizationId: input.organizationId,
    enabledByUserId: input.userId,
    ...access,
  });
  // The first batch runs now so the page has recent days right away; the cron
  // fetches the rest of the history.
  await syncTracker(site);
  await syncKeywords(site);
  await syncPagesAndGroups(site.id);
  return { id: site.id };
}

async function syncNow(site: GscTrackerSite) {
  await requireAvailable();
  await syncTracker(site);
  const fresh = await GscTrackerRepository.get(site.id);
  if (fresh) await syncKeywords(fresh);
  await syncPagesAndGroups(site.id);
}

/** A site's display settings: how positions read (7.4 or 7), how day
 *  labels read (03.10 or Oct 3) and Query Explorer's default order. */
async function updateSettings(
  site: GscTrackerSite,
  settings: {
    positionFormat?: GscTrackerPositionFormat;
    explorerSort?: GscTrackerSortKey;
    dateFormat?: GscTrackerDateFormat;
  },
) {
  await GscTrackerRepository.update(site.id, settings);
}

/** The Overview tab's widgets, in order. */
async function saveOverviewLayout(
  site: GscTrackerSite,
  widgets: GscTrackerWidget[],
) {
  await GscTrackerRepository.update(site.id, {
    overviewLayout: JSON.stringify(widgets),
  });
}

/** Stops tracking a site and deletes its stored history. */
async function removeSite(site: GscTrackerSite) {
  await GscTrackerRepository.remove(site.id);
}

async function getOverview(siteId: string, days: number) {
  const range = await periods(siteId, days);
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
        eq(gscTrackerTotals.siteId, siteId),
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

/** One query over the selected window: daily totals and the pages ranking. */
async function getQueryDetail(input: {
  siteId: string;
  query: string;
  /** The last N days up to the newest stored day, or a custom range. */
  days?: number;
  from?: string;
  to?: string;
}) {
  const range =
    input.from && input.to
      ? customPeriods(input.from, input.to)
      : await periods(input.siteId, input.days ?? 28);
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
        eq(gscTrackerRows.siteId, input.siteId),
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

export const GscTrackerService = {
  isAvailable,
  getAvailability,
  requireSite,
  getStatus,
  listSites,
  addSite,
  syncNow,
  updateSettings,
  saveOverviewLayout,
  removeSite,
  getOverview,
  compareQueries,
  getQueryDetail,
};
