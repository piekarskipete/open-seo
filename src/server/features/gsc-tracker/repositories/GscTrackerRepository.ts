import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import {
  gscTrackerKeywordDays,
  gscTrackerKeywords,
  gscTrackerPages,
  gscTrackerProjects,
  gscTrackerQueries,
  gscTrackerRows,
  gscTrackerTotals,
} from "@/db/schema";
import { GscTrackerTagRepository } from "./GscTrackerTagRepository";

export type GscTrackerProject = typeof gscTrackerProjects.$inferSelect;

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
// fit: a daily row binds 7 values, a dictionary entry 2.
const ROWS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 7);
const KEYS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 2);
const KEYS_PER_LOOKUP = DB_BATCH_SIZE - 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function get(projectId: string): Promise<GscTrackerProject | null> {
  const [row] = await db
    .select()
    .from(gscTrackerProjects)
    .where(eq(gscTrackerProjects.projectId, projectId))
    .limit(1);
  return row ?? null;
}

async function listAll(): Promise<GscTrackerProject[]> {
  return db.select().from(gscTrackerProjects);
}

async function create(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  enabledByUserId: string;
}): Promise<GscTrackerProject> {
  const [row] = await db
    .insert(gscTrackerProjects)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return row ?? (await get(input.projectId))!;
}

async function update(
  projectId: string,
  values: Partial<
    Pick<
      GscTrackerProject,
      | "siteUrl"
      | "oldestDate"
      | "newestDate"
      | "lastSyncedAt"
      | "lastError"
      | "positionFormat"
      | "explorerSort"
      | "dateFormat"
    >
  >,
): Promise<void> {
  await db
    .update(gscTrackerProjects)
    .set({ ...values, updatedAt: sql`(current_timestamp)` })
    .where(eq(gscTrackerProjects.projectId, projectId));
}

/** Drops the stored history but keeps tracking on, e.g. after the project
 *  switched to another Search Console property. */
async function clearHistory(projectId: string): Promise<void> {
  const projectKeywords = db
    .select({ id: gscTrackerKeywords.id })
    .from(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.projectId, projectId));
  await runBatch((tx) => [
    // Followed phrases stay; their fetched days start over.
    tx
      .delete(gscTrackerKeywordDays)
      .where(inArray(gscTrackerKeywordDays.keywordId, projectKeywords)),
    tx
      .update(gscTrackerKeywords)
      .set({ oldestDate: null, newestDate: null, lastSyncedAt: null })
      .where(eq(gscTrackerKeywords.projectId, projectId)),
    tx.delete(gscTrackerRows).where(eq(gscTrackerRows.projectId, projectId)),
    tx
      .delete(gscTrackerTotals)
      .where(eq(gscTrackerTotals.projectId, projectId)),
    tx
      .delete(gscTrackerQueries)
      .where(eq(gscTrackerQueries.projectId, projectId)),
    tx.delete(gscTrackerPages).where(eq(gscTrackerPages.projectId, projectId)),
  ]);
}

/** Stops tracking and deletes everything stored for the project. */
async function remove(projectId: string): Promise<void> {
  await clearHistory(projectId);
  await GscTrackerTagRepository.clearProject(projectId);
  await db
    .delete(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.projectId, projectId));
  await db
    .delete(gscTrackerProjects)
    .where(eq(gscTrackerProjects.projectId, projectId));
}

/** Ids for the given keys, adding the ones the project hasn't seen yet. */
async function resolveKeys(
  projectId: string,
  kind: "query" | "page",
  keys: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(keys)];
  const table = kind === "query" ? gscTrackerQueries : gscTrackerPages;
  const column =
    kind === "query" ? gscTrackerQueries.query : gscTrackerPages.url;
  for (const part of chunk(unique, KEYS_PER_INSERT)) {
    await db
      .insert(table)
      .values(
        part.map((key) =>
          kind === "query"
            ? { projectId, query: key }
            : { projectId, url: key },
        ),
      )
      .onConflictDoNothing();
  }
  const ids = new Map<string, number>();
  for (const part of chunk(unique, KEYS_PER_LOOKUP)) {
    const rows = await db
      .select({ id: table.id, key: column })
      .from(table)
      .where(and(eq(table.projectId, projectId), inArray(column, part)));
    for (const row of rows) ids.set(row.key, row.id);
  }
  return ids;
}

/** Replaces one day's query/page rows. Re-syncing a day is idempotent. */
async function replaceDay(input: {
  projectId: string;
  date: string;
  rows: GscTrackerDayRow[];
}): Promise<void> {
  const { projectId, date, rows } = input;
  const queryIds = await resolveKeys(
    projectId,
    "query",
    rows.map((row) => row.query),
  );
  const pageIds = await resolveKeys(
    projectId,
    "page",
    rows.map((row) => row.page),
  );
  const values = rows.flatMap((row) => {
    const queryId = queryIds.get(row.query);
    const pageId = pageIds.get(row.page);
    if (queryId === undefined || pageId === undefined) return [];
    return [
      {
        projectId,
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
        and(
          eq(gscTrackerRows.projectId, projectId),
          eq(gscTrackerRows.date, date),
        ),
      ),
    ...chunk(values, ROWS_PER_INSERT).map((part) =>
      tx.insert(gscTrackerRows).values(part),
    ),
  ]);
}

/** Replaces the whole-day totals for the given days. */
async function replaceTotals(input: {
  projectId: string;
  dates: string[];
  totals: GscTrackerDayTotals[];
}): Promise<void> {
  const { projectId, dates, totals } = input;
  if (dates.length === 0) return;
  await runBatch((tx) => [
    tx
      .delete(gscTrackerTotals)
      .where(
        and(
          eq(gscTrackerTotals.projectId, projectId),
          inArray(gscTrackerTotals.date, dates),
        ),
      ),
    ...chunk(
      totals.map((day) => ({ projectId, ...day })),
      ROWS_PER_INSERT,
    ).map((part) => tx.insert(gscTrackerTotals).values(part)),
  ]);
}

export const GscTrackerRepository = {
  get,
  listAll,
  create,
  update,
  clearHistory,
  remove,
  resolveKeys,
  replaceDay,
  replaceTotals,
};
