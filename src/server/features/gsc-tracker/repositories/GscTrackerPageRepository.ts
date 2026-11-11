import { and, eq } from "drizzle-orm";
import { DB_BATCH_SIZE, runBatch } from "@/db/runBatch";
import { gscTrackerPageDays } from "@/db/schema";
import { GscTrackerRepository, type SiteRef } from "./GscTrackerRepository";

/** One page's numbers on one day, from a page-only Search Console query. */
export type GscTrackerPageDayRow = {
  date: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

// A page day binds 7 values; D1 binds at most ~100 per statement.
const ROWS_PER_INSERT = Math.floor(DB_BATCH_SIZE / 7);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Replaces the stored page days for the given dates. Idempotent. */
async function replaceDays(input: {
  site: SiteRef;
  dates: string[];
  rows: GscTrackerPageDayRow[];
}): Promise<void> {
  const { site, dates, rows } = input;
  const pageIds = await GscTrackerRepository.resolveKeys(
    site,
    "page",
    rows.map((row) => row.page),
  );
  const byDate = new Map<string, (typeof gscTrackerPageDays.$inferInsert)[]>(
    dates.map((date) => [date, []]),
  );
  for (const row of rows) {
    const pageId = pageIds.get(row.page);
    const list = byDate.get(row.date);
    if (pageId === undefined || !list) continue;
    list.push({
      projectId: site.projectId,
      siteId: site.id,
      date: row.date,
      pageId,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }
  // One atomic batch per day keeps each batch small on large sites.
  for (const [date, values] of byDate)
    await runBatch((tx) => [
      tx
        .delete(gscTrackerPageDays)
        .where(
          and(
            eq(gscTrackerPageDays.siteId, site.id),
            eq(gscTrackerPageDays.date, date),
          ),
        ),
      ...chunk(values, ROWS_PER_INSERT).map((part) =>
        tx.insert(gscTrackerPageDays).values(part),
      ),
    ]);
}

export const GscTrackerPageRepository = { replaceDays };
