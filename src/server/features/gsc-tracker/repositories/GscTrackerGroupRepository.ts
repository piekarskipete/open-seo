import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import {
  gscTrackerPages,
  gscTrackerUrlGroupMembers,
  gscTrackerUrlGroups,
} from "@/db/schema";

export type GscTrackerUrlGroup = typeof gscTrackerUrlGroups.$inferSelect;

type MemberSource = "manual" | "rule";

// A member row binds 4 values (group, URL, source and the excluded
// default); D1 binds at most ~100 per statement.
const MEMBERS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 4);
const URLS_PER_LOOKUP = DB_BATCH_SIZE - 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

async function list(siteId: string): Promise<GscTrackerUrlGroup[]> {
  return db
    .select()
    .from(gscTrackerUrlGroups)
    .where(eq(gscTrackerUrlGroups.siteId, siteId))
    .orderBy(asc(gscTrackerUrlGroups.name));
}

/** A group of the site, or null when it belongs elsewhere. */
async function getForSite(
  siteId: string,
  groupId: string,
): Promise<GscTrackerUrlGroup | null> {
  const [row] = await db
    .select()
    .from(gscTrackerUrlGroups)
    .where(
      and(
        eq(gscTrackerUrlGroups.id, groupId),
        eq(gscTrackerUrlGroups.siteId, siteId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findByName(
  siteId: string,
  name: string,
): Promise<GscTrackerUrlGroup | null> {
  const [row] = await db
    .select()
    .from(gscTrackerUrlGroups)
    .where(
      and(
        eq(gscTrackerUrlGroups.siteId, siteId),
        sql`lower(${gscTrackerUrlGroups.name}) = ${name.toLowerCase()}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

async function create(
  values: Pick<
    GscTrackerUrlGroup,
    "id" | "projectId" | "siteId" | "name" | "kind" | "pattern"
  >,
): Promise<void> {
  await db.insert(gscTrackerUrlGroups).values(values);
}

async function update(
  groupId: string,
  values: Partial<
    Pick<
      GscTrackerUrlGroup,
      "name" | "pattern" | "scannedPageId" | "lastRefreshedAt" | "lastError"
    >
  >,
): Promise<void> {
  await db
    .update(gscTrackerUrlGroups)
    .set(values)
    .where(eq(gscTrackerUrlGroups.id, groupId));
}

async function remove(groupId: string): Promise<void> {
  await runBatch((tx) => [
    tx
      .delete(gscTrackerUrlGroupMembers)
      .where(eq(gscTrackerUrlGroupMembers.groupId, groupId)),
    tx.delete(gscTrackerUrlGroups).where(eq(gscTrackerUrlGroups.id, groupId)),
  ]);
}

/** Every URL row of a group, excluded ones too. */
async function listMembers(groupId: string) {
  return db
    .select({
      url: gscTrackerUrlGroupMembers.url,
      source: gscTrackerUrlGroupMembers.source,
      excluded: gscTrackerUrlGroupMembers.excluded,
    })
    .from(gscTrackerUrlGroupMembers)
    .where(eq(gscTrackerUrlGroupMembers.groupId, groupId));
}

/** Adds URLs a group doesn't hold yet; existing rows, excluded ones
 *  included, stay as they are. */
async function addMembers(
  groupId: string,
  urls: string[],
  source: MemberSource,
): Promise<void> {
  const unique = [...new Set(urls)];
  for (const part of chunk(unique, MEMBERS_PER_INSERT))
    await db
      .insert(gscTrackerUrlGroupMembers)
      .values(part.map((url) => ({ groupId, url, source })))
      .onConflictDoNothing();
}

/** Brings excluded URLs back into a group. */
async function includeMembers(groupId: string, urls: string[]) {
  for (const part of chunk(urls, URLS_PER_LOOKUP))
    await db
      .update(gscTrackerUrlGroupMembers)
      .set({ excluded: 0 })
      .where(
        and(
          eq(gscTrackerUrlGroupMembers.groupId, groupId),
          inArray(gscTrackerUrlGroupMembers.url, part),
        ),
      );
}

/** Takes URLs out of a group: hand-picked ones go, rule ones stay as
 *  excluded so the rule doesn't add them back. */
async function removeMembers(groupId: string, urls: string[]) {
  for (const part of chunk(urls, URLS_PER_LOOKUP)) {
    const inGroup = and(
      eq(gscTrackerUrlGroupMembers.groupId, groupId),
      inArray(gscTrackerUrlGroupMembers.url, part),
    );
    await runBatch((tx) => [
      tx
        .delete(gscTrackerUrlGroupMembers)
        .where(and(inGroup, eq(gscTrackerUrlGroupMembers.source, "manual"))),
      tx
        .update(gscTrackerUrlGroupMembers)
        .set({ excluded: 1 })
        .where(and(inGroup, eq(gscTrackerUrlGroupMembers.source, "rule"))),
    ]);
  }
}

/** Renames a member to the URL Search Console reports for the same page,
 *  unless the group already holds that URL. */
async function renameMember(groupId: string, from: string, to: string) {
  const [existing] = await db
    .select({ url: gscTrackerUrlGroupMembers.url })
    .from(gscTrackerUrlGroupMembers)
    .where(
      and(
        eq(gscTrackerUrlGroupMembers.groupId, groupId),
        eq(gscTrackerUrlGroupMembers.url, to),
      ),
    )
    .limit(1);
  const member = and(
    eq(gscTrackerUrlGroupMembers.groupId, groupId),
    eq(gscTrackerUrlGroupMembers.url, from),
  );
  if (existing) await db.delete(gscTrackerUrlGroupMembers).where(member);
  else
    await db.update(gscTrackerUrlGroupMembers).set({ url: to }).where(member);
}

/** The site's pages seen after `afterId`, oldest first. */
async function pagesAfter(siteId: string, afterId: number, limit: number) {
  return db
    .select({ id: gscTrackerPages.id, url: gscTrackerPages.url })
    .from(gscTrackerPages)
    .where(
      and(eq(gscTrackerPages.siteId, siteId), gt(gscTrackerPages.id, afterId)),
    )
    .orderBy(asc(gscTrackerPages.id))
    .limit(limit);
}

/** Included URL counts per group of the site. */
async function memberCounts(siteId: string): Promise<Map<string, number>> {
  const m = gscTrackerUrlGroupMembers;
  const rows = await db
    .select({
      groupId: m.groupId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(m)
    .innerJoin(gscTrackerUrlGroups, eq(gscTrackerUrlGroups.id, m.groupId))
    .where(and(eq(gscTrackerUrlGroups.siteId, siteId), eq(m.excluded, 0)))
    .groupBy(m.groupId);
  return new Map(rows.map((row) => [row.groupId, row.count]));
}

export const GscTrackerGroupRepository = {
  list,
  getForSite,
  findByName,
  create,
  update,
  remove,
  listMembers,
  addMembers,
  includeMembers,
  removeMembers,
  renameMember,
  pagesAfter,
  memberCounts,
};
