import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  gscTrackerPageDays,
  gscTrackerPages,
  gscTrackerTotals,
  gscTrackerUrlGroupMembers,
  gscTrackerUrlGroups,
} from "@/db/schema";
import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import { GscTrackerGroupRepository } from "../repositories/GscTrackerGroupRepository";
import type { AlertCandidate } from "./gscTrackerAlertPhrases";
import { addDays } from "./gscTrackerDates";
import { groupTotals } from "./gscTrackerPageStats";
import type { GscTrackerAlertParams } from "@/shared/gsc-tracker-alerts";

// Alert checks on page groups, the whole site and the tracker's own syncs.

const WEEK = 7;
// URLs one "pages lost" or "new URLs" alert names at most.
const MAX_LISTED_URLS = 20;

/** The last 7 days up to `end` and the 7 before. */
function weeks(end: string) {
  return {
    currentStart: addDays(end, -(WEEK - 1)),
    currentEnd: end,
    previousStart: addDays(end, -(2 * WEEK - 1)),
    previousEnd: addDays(end, -WEEK),
  };
}

/** The newest day both the query history and the page history reach. */
function pageDay(site: GscTrackerSite, evalDate: string): string | null {
  if (!site.pagesNewestDate) return null;
  return site.pagesNewestDate < evalDate ? site.pagesNewestDate : evalDate;
}

function dropPercent(previous: number, current: number) {
  return previous > 0 ? Math.round(((previous - current) / previous) * 100) : 0;
}

async function groupTrafficDrop(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const end = pageDay(site, evalDate);
  if (!end) return [];
  const percent = params.percent ?? 20;
  const minClicks = params.minClicks ?? 0;
  const [groups, totals] = await Promise.all([
    GscTrackerGroupRepository.list(site.id),
    groupTotals(site, weeks(end)),
  ]);
  return groups.flatMap((group) => {
    if (params.groupId && group.id !== params.groupId) return [];
    const numbers = totals.get(group.id);
    if (!numbers) return [];
    const before = numbers.previous.clicks;
    const now = numbers.current.clicks;
    const drop = dropPercent(before, now);
    if (before < minClicks || drop < percent) return [];
    return [
      {
        subject: group.id,
        date: end,
        title: `Group “${group.name}” lost ${drop}% of its clicks`,
        line: `${group.name}: ${before} → ${now} clicks (−${drop}%)`,
        message: `${now} clicks in the 7 days to ${end}, against ${before} the 7 days before.`,
        data: { group: group.name, clicks: now, previousClicks: before, drop },
      },
    ];
  });
}

async function siteTrafficDrop(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const percent = params.percent ?? 20;
  const minClicks = params.minClicks ?? 0;
  const range = weeks(evalDate);
  const t = gscTrackerTotals;
  const [row] = await db
    .select({
      now: sql<number>`sum(case when ${t.date} >= ${range.currentStart} then ${t.clicks} else 0 end)`.mapWith(
        Number,
      ),
      before:
        sql<number>`sum(case when ${t.date} < ${range.currentStart} then ${t.clicks} else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(t)
    .where(
      and(
        eq(t.siteId, site.id),
        gte(t.date, range.previousStart),
        lte(t.date, range.currentEnd),
      ),
    );
  const before = row?.before ?? 0;
  const now = row?.now ?? 0;
  const drop = dropPercent(before, now);
  if (before < minClicks || drop < percent) return [];
  return [
    {
      subject: "site",
      date: evalDate,
      title: `${site.siteUrl} lost ${drop}% of its clicks`,
      line: `Whole site: ${before} → ${now} clicks (−${drop}%)`,
      message: `${now} clicks in the 7 days to ${evalDate}, against ${before} the 7 days before.`,
      data: { clicks: now, previousClicks: before, drop },
    },
  ];
}

async function groupPagesLost(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const end = pageDay(site, evalDate);
  if (!end) return [];
  const quiet = params.days ?? 14;
  const quietStart = addDays(end, -(quiet - 1));
  const before = addDays(quietStart, -30);
  const m = gscTrackerUrlGroupMembers;
  const d = gscTrackerPageDays;
  const rows = await db
    .select({
      groupId: m.groupId,
      group: gscTrackerUrlGroups.name,
      url: m.url,
      earlier:
        sql<number>`sum(case when ${d.date} < ${quietStart} then ${d.impressions} else 0 end)`.mapWith(
          Number,
        ),
      recent:
        sql<number>`sum(case when ${d.date} >= ${quietStart} then ${d.impressions} else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(m)
    .innerJoin(gscTrackerUrlGroups, eq(gscTrackerUrlGroups.id, m.groupId))
    .innerJoin(
      gscTrackerPages,
      and(eq(gscTrackerPages.siteId, site.id), eq(gscTrackerPages.url, m.url)),
    )
    .innerJoin(d, eq(d.pageId, gscTrackerPages.id))
    .where(
      and(
        eq(gscTrackerUrlGroups.siteId, site.id),
        eq(m.excluded, 0),
        params.groupId ? eq(m.groupId, params.groupId) : undefined,
        gte(d.date, before),
        lte(d.date, end),
      ),
    )
    .groupBy(m.groupId, gscTrackerUrlGroups.name, m.url);
  return rows
    .filter(
      (row) =>
        row.earlier >= Math.max(1, params.minImpressions ?? 0) &&
        row.recent === 0,
    )
    .slice(0, MAX_LISTED_URLS * 5)
    .map((row) => ({
      subject: row.url,
      date: end,
      title: `A page of “${row.group}” lost its impressions`,
      line: `${row.url} (${row.group}): ${row.earlier} impressions before, none in ${quiet} days`,
      message: `${row.url} had ${row.earlier} impressions in the month before and none in the ${quiet} days to ${end}.`,
      data: { group: row.group, url: row.url, earlierImpressions: row.earlier },
    }));
}

async function sitemapNewUrls(
  site: GscTrackerSite,
  _evalDate: string,
  params: GscTrackerAlertParams,
  now: Date,
): Promise<AlertCandidate[]> {
  const today = now.toISOString().slice(0, 10);
  const groups = (await GscTrackerGroupRepository.list(site.id)).filter(
    (group) =>
      group.kind === "sitemap" &&
      (!params.groupId || group.id === params.groupId),
  );
  if (groups.length === 0) return [];
  const m = gscTrackerUrlGroupMembers;
  const addedDay = sql<string>`substr(${m.addedAt}, 1, 10)`;
  const rows = await db
    .select({ groupId: m.groupId, url: m.url, day: addedDay })
    .from(m)
    .where(
      and(
        inArray(
          m.groupId,
          groups.map((group) => group.id),
        ),
        eq(m.source, "rule"),
        gte(addedDay, addDays(today, -1)),
      ),
    );
  return groups.flatMap((group) => {
    // The URLs a group starts with aren't news.
    const created = group.createdAt.slice(0, 10);
    const byDay = new Map<string, string[]>();
    for (const row of rows) {
      if (row.groupId !== group.id || row.day <= created) continue;
      byDay.set(row.day, [...(byDay.get(row.day) ?? []), row.url]);
    }
    return [...byDay].map(([day, urls]) => ({
      subject: group.id,
      date: day,
      title: `${urls.length} new URL${urls.length === 1 ? "" : "s"} in “${group.name}”`,
      line: `${group.name}: ${urls.slice(0, 5).join(", ")}${urls.length > 5 ? ` +${urls.length - 5} more` : ""}`,
      message: `The sitemap ${group.pattern ?? ""} lists new URLs: ${urls.slice(0, MAX_LISTED_URLS).join(", ")}${urls.length > MAX_LISTED_URLS ? "…" : ""}`,
      data: {
        group: group.name,
        urls: urls.slice(0, MAX_LISTED_URLS),
        count: urls.length,
      },
    }));
  });
}

async function syncError(
  site: GscTrackerSite,
  _evalDate: string,
  _params: GscTrackerAlertParams,
  now: Date,
): Promise<AlertCandidate[]> {
  const today = now.toISOString().slice(0, 10);
  const alerts: AlertCandidate[] = [];
  if (site.lastError)
    alerts.push({
      subject: `site: ${site.lastError}`,
      date: today,
      title: `${site.siteUrl}: Search Console sync failed`,
      line: `Search Console: ${site.lastError}`,
      message: site.lastError,
      data: { error: site.lastError },
    });
  for (const group of await GscTrackerGroupRepository.list(site.id))
    if (group.lastError)
      alerts.push({
        subject: `group ${group.id}: ${group.lastError}`,
        date: today,
        title: `Group “${group.name}” couldn't be refreshed`,
        line: `Group ${group.name}: ${group.lastError}`,
        message: group.lastError,
        data: { group: group.name, error: group.lastError },
      });
  return alerts;
}

export const PageAlerts = {
  group_traffic_drop: groupTrafficDrop,
  site_traffic_drop: siteTrafficDrop,
  group_pages_lost: groupPagesLost,
  sitemap_new_urls: sitemapNewUrls,
  sync_error: syncError,
};
