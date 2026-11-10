import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import {
  gscTrackerKeywordDays,
  gscTrackerKeywords,
  gscTrackerPages,
} from "@/db/schema";
import { GscTrackerRepository } from "./GscTrackerRepository";

export type GscTrackerKeyword = typeof gscTrackerKeywords.$inferSelect;

type KeywordDayRow = {
  keywordId: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

// A keyword day binds 6 values; keep each insert under D1's ~100 limit.
const ROWS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 6);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function list(projectId: string): Promise<GscTrackerKeyword[]> {
  return db
    .select()
    .from(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.projectId, projectId))
    .orderBy(
      gscTrackerKeywords.createdAt,
      gscTrackerKeywords.query,
      gscTrackerKeywords.targetUrl,
    );
}

/** Follows phrase/URL pairs; a pair already followed is left as it is. */
async function upsertMany(
  projectId: string,
  entries: { query: string; targetUrl: string }[],
): Promise<void> {
  for (const part of chunk(entries, Math.floor(DB_BATCH_SIZE / 4))) {
    await db
      .insert(gscTrackerKeywords)
      .values(
        part.map((entry) => ({
          id: crypto.randomUUID(),
          projectId,
          query: entry.query,
          targetUrl: entry.targetUrl,
        })),
      )
      .onConflictDoNothing();
  }
}

async function remove(projectId: string, id: string): Promise<void> {
  await db
    .delete(gscTrackerKeywordDays)
    .where(eq(gscTrackerKeywordDays.keywordId, id));
  await db
    .delete(gscTrackerKeywords)
    .where(
      and(
        eq(gscTrackerKeywords.id, id),
        eq(gscTrackerKeywords.projectId, projectId),
      ),
    );
}

async function updateRange(
  id: string,
  values: Partial<
    Pick<GscTrackerKeyword, "oldestDate" | "newestDate" | "lastSyncedAt">
  >,
): Promise<void> {
  await db
    .update(gscTrackerKeywords)
    .set(values)
    .where(eq(gscTrackerKeywords.id, id));
}

/** Replaces one day for the given phrases: every page Search Console showed. */
async function replaceDay(input: {
  projectId: string;
  keywordIds: string[];
  date: string;
  rows: KeywordDayRow[];
}): Promise<void> {
  const pageIds = await GscTrackerRepository.resolveKeys(
    input.projectId,
    "page",
    input.rows.map((row) => row.page),
  );
  const values = input.rows.flatMap((row) => {
    const pageId = pageIds.get(row.page);
    if (pageId === undefined) return [];
    return [
      {
        keywordId: row.keywordId,
        date: input.date,
        pageId,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      },
    ];
  });
  await runBatch((tx) => [
    tx
      .delete(gscTrackerKeywordDays)
      .where(
        and(
          inArray(gscTrackerKeywordDays.keywordId, input.keywordIds),
          eq(gscTrackerKeywordDays.date, input.date),
        ),
      ),
    ...chunk(values, ROWS_PER_INSERT).map((part) =>
      tx.insert(gscTrackerKeywordDays).values(part),
    ),
  ]);
}

/** Every stored page-day for the project's phrases between two dates. */
async function listDays(input: {
  projectId: string;
  from: string;
  to: string;
}) {
  return db
    .select({
      keywordId: gscTrackerKeywordDays.keywordId,
      date: gscTrackerKeywordDays.date,
      page: gscTrackerPages.url,
      clicks: gscTrackerKeywordDays.clicks,
      impressions: gscTrackerKeywordDays.impressions,
      position: gscTrackerKeywordDays.position,
    })
    .from(gscTrackerKeywordDays)
    .innerJoin(
      gscTrackerKeywords,
      eq(gscTrackerKeywords.id, gscTrackerKeywordDays.keywordId),
    )
    .innerJoin(
      gscTrackerPages,
      eq(gscTrackerPages.id, gscTrackerKeywordDays.pageId),
    )
    .where(
      and(
        eq(gscTrackerKeywords.projectId, input.projectId),
        gte(gscTrackerKeywordDays.date, input.from),
        lte(gscTrackerKeywordDays.date, input.to),
      ),
    );
}

/** Sets the day a phrase's progress is measured from; null resets it to the
 *  day it was added. */
async function setStartDate(input: {
  projectId: string;
  id: string;
  startDate: string | null;
}): Promise<void> {
  await db
    .update(gscTrackerKeywords)
    .set({ startDate: input.startDate })
    .where(
      and(
        eq(gscTrackerKeywords.id, input.id),
        eq(gscTrackerKeywords.projectId, input.projectId),
      ),
    );
}

/** One phrase's stored page-days between two dates, oldest first. */
async function listKeywordDays(input: {
  keywordId: string;
  from: string;
  to: string;
}) {
  return db
    .select({
      date: gscTrackerKeywordDays.date,
      page: gscTrackerPages.url,
      clicks: gscTrackerKeywordDays.clicks,
      impressions: gscTrackerKeywordDays.impressions,
      position: gscTrackerKeywordDays.position,
    })
    .from(gscTrackerKeywordDays)
    .innerJoin(
      gscTrackerPages,
      eq(gscTrackerPages.id, gscTrackerKeywordDays.pageId),
    )
    .where(
      and(
        eq(gscTrackerKeywordDays.keywordId, input.keywordId),
        gte(gscTrackerKeywordDays.date, input.from),
        lte(gscTrackerKeywordDays.date, input.to),
      ),
    )
    .orderBy(gscTrackerKeywordDays.date);
}

export const GscTrackerKeywordRepository = {
  list,
  upsertMany,
  remove,
  updateRange,
  replaceDay,
  listDays,
  setStartDate,
  listKeywordDays,
};
