import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as ChartModule from "./gscTrackerKeywordChart";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: {
    getConnection: vi.fn(async () => null),
    getPerformance: vi.fn(async () => ({ rows: [] })),
  },
  isExpectedGrantFailure: () => false,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => undefined,
}));

let client: Client;
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-chart-"));
let getKeywordChart: typeof ChartModule.getKeywordChart;
type Build = Parameters<typeof runBatch>[0];

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "test.db")}` });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    runBatch: async (build: Build) => {
      await testDb.transaction(async (tx) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- real SQLite Drizzle executor has the same query-builder surface
        for (const statement of build(tx as unknown as Parameters<Build>[0]))
          await statement;
      });
    },
  }));
  await client.executeMultiple(`
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org1');
    INSERT INTO projects VALUES ('p1'), ('p2');
  `);
  for (const file of [
    "drizzle/sqlite/0069_gsc_tracker.sql",
    "drizzle/sqlite/0070_gsc_tracker_keywords.sql",
    "drizzle/sqlite/0071_gsc_tracker_explorer_sort.sql",
    "drizzle/sqlite/0072_gsc_tracker_keyword_targets.sql",
    "drizzle/sqlite/0073_gsc_tracker_date_format.sql",
    "drizzle/sqlite/0074_gsc_tracker_keyword_start.sql",
    "drizzle/sqlite/0075_gsc_tracker_tags.sql",
    "drizzle/sqlite/0076_gsc_tracker_checkpoints.sql",
    "drizzle/sqlite/0077_gsc_tracker_sites.sql",
    "drizzle/sqlite/0078_gsc_tracker_drop_projects.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ getKeywordChart } = await import("./gscTrackerKeywordChart"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM gsc_tracker_keyword_days; DELETE FROM gsc_tracker_keywords;
    DELETE FROM gsc_tracker_pages; DELETE FROM gsc_tracker_sites;
    INSERT INTO gsc_tracker_sites (id, project_id, organization_id, site_url, enabled_by_user_id)
      VALUES ('p1', 'p1', 'org1', 'sc-domain:example.com', 'u1'),
             ('p2', 'p2', 'org1', 'sc-domain:other.com', 'u1');
    INSERT INTO gsc_tracker_pages (id, project_id, site_id, url) VALUES
      (1, 'p1', 'p1', 'https://x/a/'), (2, 'p1', 'p1', 'https://x/b');
    INSERT INTO gsc_tracker_keywords
      (id, project_id, site_id, query, target_url, oldest_date, newest_date)
      VALUES ('k1', 'p1', 'p1', 'shoes', 'https://x/a', '2026-10-25', '2026-11-08');
    INSERT INTO gsc_tracker_keyword_days
      (keyword_id, date, page_id, clicks, impressions, position) VALUES
      -- Previous 7 days (10-26..11-01): one day.
      ('k1', '2026-10-30', 1, 1, 10, 9),
      -- Current 7 days (11-02..11-08): two days on the target, one on a
      -- competing page that doesn't count.
      ('k1', '2026-11-03', 1, 2, 20, 4),
      ('k1', '2026-11-05', 1, 4, 20, 2),
      ('k1', '2026-11-05', 2, 9, 90, 1);
  `);
});

it("charts a phrase's target URL day by day with the period's totals", async () => {
  const chart = await getKeywordChart({ siteId: "p1", id: "k1", days: 7 });
  expect(chart.start).toBe("2026-11-02");
  expect(chart.end).toBe("2026-11-08");
  // Every day of the period, empty days without a position.
  expect(chart.series).toHaveLength(7);
  expect(chart.series[0]).toMatchObject({ clicks: 0, position: null });
  expect(chart.series[1]).toMatchObject({ date: "2026-11-03", position: 4 });
  // Target URL only: 6 clicks, 40 impressions, position weighted 3.
  expect(chart.current).toMatchObject({ clicks: 6, impressions: 40 });
  expect(chart.current.position).toBeCloseTo(3);
  expect(chart.perDay.clicks).toBeCloseTo(6 / 7);
  expect(chart.previous).toMatchObject({ clicks: 1, position: 9 });

  await expect(
    getKeywordChart({ siteId: "p2", id: "k1", days: 7 }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("measures progress since the start and between checkpoints", async () => {
  await client.execute(
    "UPDATE gsc_tracker_keywords SET start_date = '2026-10-28', checkpoint1_date = '2026-11-03'",
  );
  const one = await getKeywordChart({ siteId: "p1", id: "k1", days: 7 });
  // Start: the first measured day from then on; checkpoint: the last up to it.
  expect(one.markers.start.point).toEqual({ date: "2026-10-30", position: 9 });
  expect(one.markers.checkpoints).toEqual([
    { date: "2026-11-03", point: { date: "2026-11-03", position: 4 } },
  ]);
  expect(one.sinceStart).toMatchObject({
    from: "2026-10-28",
    to: "2026-11-08",
    clicks: 7,
    impressions: 50,
    change: 7,
  });
  // One checkpoint: start to checkpoint 1.
  expect(one.checkpointRange).toMatchObject({
    fromLabel: "Start",
    toLabel: "Checkpoint 1",
    clicks: 3,
    change: 5,
  });

  await client.execute(
    "UPDATE gsc_tracker_keywords SET checkpoint2_date = '2026-11-05'",
  );
  const two = await getKeywordChart({ siteId: "p1", id: "k1", days: 7 });
  // Two checkpoints: checkpoint 1 to checkpoint 2.
  expect(two.checkpointRange).toMatchObject({
    fromLabel: "Checkpoint 1",
    toLabel: "Checkpoint 2",
    first: { date: "2026-11-03", position: 4 },
    last: { date: "2026-11-05", position: 2 },
    change: 2,
  });
});

it("charts a custom range against the same length before it", async () => {
  const chart = await getKeywordChart({
    siteId: "p1",
    id: "k1",
    from: "2026-11-05",
    to: "2026-11-03",
  });
  // Ends in either order; three days, the previous three before them.
  expect([chart.start, chart.end]).toEqual(["2026-11-03", "2026-11-05"]);
  expect(chart.series.map((point) => point.date)).toEqual([
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
  ]);
  expect(chart.current).toMatchObject({ clicks: 6, impressions: 40 });
  expect(chart.previous.clicks).toBe(0);

  await expect(
    getKeywordChart({
      siteId: "p1",
      id: "k1",
      from: "2024-01-01",
      to: "2026-11-05",
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
