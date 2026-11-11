import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import {
  gscTrackerKeywordDays,
  gscTrackerKeywords,
  gscTrackerPageDays,
  gscTrackerPages,
  gscTrackerQueries,
  gscTrackerRows,
  gscTrackerSites,
  gscTrackerTotals,
  gscTrackerUrlGroupMembers,
  gscTrackerUrlGroups,
} from "@/db/schema";
import { GscTrackerTagRepository } from "./GscTrackerTagRepository";

export type GscTrackerSite = typeof gscTrackerSites.$inferSelect;

/** What tracker rows are keyed by: the site, and its project for the
 *  project-wide foreign key. */
export type SiteRef = Pick<GscTrackerSite, "id" | "projectId">;

type GscTrackerDayRow = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

type GscTrackerDayTotals = {
  date: string;
  clicks: number;
  impressions: number;
  position: number;
};

// D1 binds at most ~100 values per statement, so multi-row inserts are cut to
// fit: a daily row binds 8 values, a dictionary entry 3.
const ROWS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 8);
const KEYS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 3);
const KEYS_PER_LOOKUP = DB_BATCH_SIZE - 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function get(siteId: string): Promise<GscTrackerSite | null> {
  const [row] = await db
    .select()
    .from(gscTrackerSites)
    .where(eq(gscTrackerSites.id, siteId))
    .limit(1);
  return row ?? null;
}

/** A site of the project, or null when it belongs elsewhere. */
async function getForProject(
  projectId: string,
  siteId: string,
): Promise<GscTrackerSite | null> {
  const [row] = await db
    .select()
    .from(gscTrackerSites)
    .where(
      and(
        eq(gscTrackerSites.id, siteId),
        eq(gscTrackerSites.projectId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listForProject(projectId: string): Promise<GscTrackerSite[]> {
  return db
    .select()
    .from(gscTrackerSites)
    .where(eq(gscTrackerSites.projectId, projectId))
    .orderBy(gscTrackerSites.createdAt, gscTrackerSites.siteUrl);
}

async function listAll(): Promise<GscTrackerSite[]> {
  return db.select().from(gscTrackerSites);
}

async function create(input: {
  id?: string;
  projectId: string;
  organizationId: string;
  siteUrl: string;
  enabledByUserId: string;
  gscAccountId?: string | null;
  serviceAccountId?: string | null;
  connectedByUserId?: string | null;
  connectedAccountEmail?: string | null;
}): Promise<GscTrackerSite> {
  const id = input.id ?? crypto.randomUUID();
  await db
    .insert(gscTrackerSites)
    .values({ ...input, id })
    .onConflictDoNothing();
  const created = await get(id);
  if (created) return created;
  // The project already tracks this property.
  const [existing] = await db
    .select()
    .from(gscTrackerSites)
    .where(
      and(
        eq(gscTrackerSites.projectId, input.projectId),
        eq(gscTrackerSites.siteUrl, input.siteUrl),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("GSC Tracker site was not stored.");
  return existing;
}

async function update(
  siteId: string,
  values: Partial<
    Pick<
      GscTrackerSite,
      | "siteUrl"
      | "oldestDate"
      | "newestDate"
      | "lastSyncedAt"
      | "lastError"
      | "positionFormat"
      | "explorerSort"
      | "dateFormat"
      | "pagesOldestDate"
      | "pagesNewestDate"
      | "pagesSyncedAt"
      | "overviewLayout"
      | "cannibalExclusions"
    >
  >,
): Promise<void> {
  await db
    .update(gscTrackerSites)
    .set({ ...values, updatedAt: sql`(current_timestamp)` })
    .where(eq(gscTrackerSites.id, siteId));
}

/** Drops the site's stored history but keeps tracking on, e.g. after its
 *  property changed. */
async function clearHistory(siteId: string): Promise<void> {
  const siteKeywords = db
    .select({ id: gscTrackerKeywords.id })
    .from(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.siteId, siteId));
  await runBatch((tx) => [
    // Followed phrases stay; their fetched days start over.
    tx
      .delete(gscTrackerKeywordDays)
      .where(inArray(gscTrackerKeywordDays.keywordId, siteKeywords)),
    tx
      .update(gscTrackerKeywords)
      .set({ oldestDate: null, newestDate: null, lastSyncedAt: null })
      .where(eq(gscTrackerKeywords.siteId, siteId)),
    tx.delete(gscTrackerRows).where(eq(gscTrackerRows.siteId, siteId)),
    tx.delete(gscTrackerTotals).where(eq(gscTrackerTotals.siteId, siteId)),
    tx.delete(gscTrackerPageDays).where(eq(gscTrackerPageDays.siteId, siteId)),
    tx.delete(gscTrackerQueries).where(eq(gscTrackerQueries.siteId, siteId)),
    tx.delete(gscTrackerPages).where(eq(gscTrackerPages.siteId, siteId)),
  ]);
}

/** Stops tracking the site and deletes everything stored for it. */
async function remove(siteId: string): Promise<void> {
  await clearHistory(siteId);
  await GscTrackerTagRepository.clearSite(siteId);
  const siteGroups = db
    .select({ id: gscTrackerUrlGroups.id })
    .from(gscTrackerUrlGroups)
    .where(eq(gscTrackerUrlGroups.siteId, siteId));
  await runBatch((tx) => [
    tx
      .delete(gscTrackerUrlGroupMembers)
      .where(inArray(gscTrackerUrlGroupMembers.groupId, siteGroups)),
    tx
      .delete(gscTrackerUrlGroups)
      .where(eq(gscTrackerUrlGroups.siteId, siteId)),
  ]);
  await db
    .delete(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.siteId, siteId));
  await db.delete(gscTrackerSites).where(eq(gscTrackerSites.id, siteId));
}

/** Removes the project's sites that use its Search Console connection,
 *  when that connection goes away. */
async function removeProjectConnectionSites(projectId: string): Promise<void> {
  const sites = await listForProject(projectId);
  for (const site of sites)
    if (site.connectedByUserId === null) await remove(site.id);
}

/** Ids for the given keys, adding the ones the site hasn't seen yet. */
async function resolveKeys(
  site: SiteRef,
  kind: "query" | "page",
  keys: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(keys)];
  const table = kind === "query" ? gscTrackerQueries : gscTrackerPages;
  const column =
    kind === "query" ? gscTrackerQueries.query : gscTrackerPages.url;
  const scope = { projectId: site.projectId, siteId: site.id };
  for (const part of chunk(unique, KEYS_PER_INSERT)) {
    await db
      .insert(table)
      .values(
        part.map((key) =>
          kind === "query" ? { ...scope, query: key } : { ...scope, url: key },
        ),
      )
      .onConflictDoNothing();
  }
  const ids = new Map<string, number>();
  for (const part of chunk(unique, KEYS_PER_LOOKUP)) {
    const rows = await db
      .select({ id: table.id, key: column })
      .from(table)
      .where(and(eq(table.siteId, site.id), inArray(column, part)));
    for (const row of rows) ids.set(row.key, row.id);
  }
  return ids;
}

/** Replaces one day's query/page rows. Re-syncing a day is idempotent. */
async function replaceDay(input: {
  site: SiteRef;
  date: string;
  rows: GscTrackerDayRow[];
}): Promise<void> {
  const { site, date, rows } = input;
  const queryIds = await resolveKeys(
    site,
    "query",
    rows.map((row) => row.query),
  );
  const pageIds = await resolveKeys(
    site,
    "page",
    rows.map((row) => row.page),
  );
  const values = rows.flatMap((row) => {
    const queryId = queryIds.get(row.query);
    const pageId = pageIds.get(row.page);
    if (queryId === undefined || pageId === undefined) return [];
    return [
      {
        projectId: site.projectId,
        siteId: site.id,
        date,
        queryId,
        pageId,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      },
    ];
  });
  await runBatch((tx) => [
    tx
      .delete(gscTrackerRows)
      .where(
        and(eq(gscTrackerRows.siteId, site.id), eq(gscTrackerRows.date, date)),
      ),
    ...chunk(values, ROWS_PER_INSERT).map((part) =>
      tx.insert(gscTrackerRows).values(part),
    ),
  ]);
}

/** Replaces the whole-day totals for the given days. */
async function replaceTotals(input: {
  site: SiteRef;
  dates: string[];
  totals: GscTrackerDayTotals[];
}): Promise<void> {
  const { site, dates, totals } = input;
  if (dates.length === 0) return;
  await runBatch((tx) => [
    tx
      .delete(gscTrackerTotals)
      .where(
        and(
          eq(gscTrackerTotals.siteId, site.id),
          inArray(gscTrackerTotals.date, dates),
        ),
      ),
    ...chunk(
      totals.map((day) => ({
        projectId: site.projectId,
        siteId: site.id,
        ...day,
      })),
      ROWS_PER_INSERT,
    ).map((part) => tx.insert(gscTrackerTotals).values(part)),
  ]);
}

export const GscTrackerRepository = {
  get,
  getForProject,
  listForProject,
  listAll,
  create,
  update,
  clearHistory,
  remove,
  removeProjectConnectionSites,
  resolveKeys,
  replaceDay,
  replaceTotals,
};
