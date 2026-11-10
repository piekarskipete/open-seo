import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE } from "@/db/runBatch";
import {
  gscTrackerKeywordTags,
  gscTrackerKeywords,
  gscTrackerTags,
} from "@/db/schema";

type GscTrackerTag = typeof gscTrackerTags.$inferSelect;

// An assignment binds 2 values; keep each statement under D1's ~100 limit.
const IDS_PER_STATEMENT = Math.floor(DB_BATCH_SIZE / 2);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function list(siteId: string): Promise<GscTrackerTag[]> {
  return db
    .select()
    .from(gscTrackerTags)
    .where(eq(gscTrackerTags.siteId, siteId))
    .orderBy(gscTrackerTags.name);
}

async function create(input: {
  id: string;
  projectId: string;
  siteId: string;
  name: string;
  color: string;
}): Promise<void> {
  await db.insert(gscTrackerTags).values(input);
}

async function update(
  siteId: string,
  id: string,
  values: Partial<Pick<GscTrackerTag, "name" | "color">>,
): Promise<void> {
  await db
    .update(gscTrackerTags)
    .set(values)
    .where(and(eq(gscTrackerTags.id, id), eq(gscTrackerTags.siteId, siteId)));
}

async function remove(siteId: string, id: string): Promise<void> {
  await db
    .delete(gscTrackerKeywordTags)
    .where(eq(gscTrackerKeywordTags.tagId, id));
  await db
    .delete(gscTrackerTags)
    .where(and(eq(gscTrackerTags.id, id), eq(gscTrackerTags.siteId, siteId)));
}

/** Every tag assignment of the site's phrases. */
async function listAssignments(
  siteId: string,
): Promise<{ keywordId: string; tagId: string }[]> {
  return db
    .select({
      keywordId: gscTrackerKeywordTags.keywordId,
      tagId: gscTrackerKeywordTags.tagId,
    })
    .from(gscTrackerKeywordTags)
    .innerJoin(
      gscTrackerTags,
      eq(gscTrackerTags.id, gscTrackerKeywordTags.tagId),
    )
    .where(eq(gscTrackerTags.siteId, siteId));
}

async function assign(tagId: string, keywordIds: string[]): Promise<void> {
  for (const part of chunk(keywordIds, IDS_PER_STATEMENT)) {
    await db
      .insert(gscTrackerKeywordTags)
      .values(part.map((keywordId) => ({ keywordId, tagId })))
      .onConflictDoNothing();
  }
}

async function unassign(tagId: string, keywordIds: string[]): Promise<void> {
  for (const part of chunk(keywordIds, IDS_PER_STATEMENT - 1)) {
    await db
      .delete(gscTrackerKeywordTags)
      .where(
        and(
          eq(gscTrackerKeywordTags.tagId, tagId),
          inArray(gscTrackerKeywordTags.keywordId, part),
        ),
      );
  }
}

/** Drops a phrase's tags, before the phrase itself is removed. */
async function clearKeyword(keywordId: string): Promise<void> {
  await db
    .delete(gscTrackerKeywordTags)
    .where(eq(gscTrackerKeywordTags.keywordId, keywordId));
}

/** Drops every tag of the site and their assignments. */
async function clearSite(siteId: string): Promise<void> {
  const siteKeywords = db
    .select({ id: gscTrackerKeywords.id })
    .from(gscTrackerKeywords)
    .where(eq(gscTrackerKeywords.siteId, siteId));
  await db
    .delete(gscTrackerKeywordTags)
    .where(inArray(gscTrackerKeywordTags.keywordId, siteKeywords));
  await db.delete(gscTrackerTags).where(eq(gscTrackerTags.siteId, siteId));
}

export const GscTrackerTagRepository = {
  list,
  create,
  update,
  remove,
  listAssignments,
  assign,
  unassign,
  clearKeyword,
  clearSite,
};
