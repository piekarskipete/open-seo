import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as RankModule from "./gscTrackerRankLink";
import type * as SiteModule from "../repositories/GscTrackerRepository";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getConnection: vi.fn(async () => null) },
  isExpectedGrantFailure: () => false,
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => undefined,
}));

let client: Client;
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-rank-"));
let rank: typeof RankModule.GscTrackerRankLink;
let sites: typeof SiteModule.GscTrackerRepository;
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
  // Rank Tracking's tables, with the columns the comparison reads.
  await client.executeMultiple(`
    CREATE TABLE organization (id text PRIMARY KEY);
    CREATE TABLE projects (id text PRIMARY KEY);
    INSERT INTO organization VALUES ('org1');
    INSERT INTO projects VALUES ('p1'), ('p2');
    CREATE TABLE rank_tracking_configs (
      id text PRIMARY KEY, project_id text, domain text,
      location_code integer, language_code text, location_name text,
      devices text, is_active integer, created_at text);
    CREATE TABLE rank_tracking_keywords (
      id text PRIMARY KEY, config_id text, keyword text);
    CREATE TABLE rank_check_runs (id text PRIMARY KEY, config_id text);
    CREATE TABLE rank_snapshots (
      id integer PRIMARY KEY AUTOINCREMENT, run_id text,
      tracking_keyword_id text, keyword text, device text,
      position integer, url text, checked_at text);
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
    "drizzle/sqlite/0079_gsc_tracker_url_groups.sql",
    "drizzle/sqlite/0080_gsc_tracker_overview_settings.sql",
    "drizzle/sqlite/0081_gsc_tracker_rank_link.sql",
    "drizzle/sqlite/0082_gsc_tracker_alerts.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ GscTrackerRankLink: rank } = await import("./gscTrackerRankLink"));
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

it("reads the linked domain's positions per followed phrase and day", async () => {
  await client.executeMultiple(`
    INSERT INTO gsc_tracker_sites (id, project_id, organization_id, site_url, enabled_by_user_id)
      VALUES ('s1', 'p1', 'org1', 'sc-domain:example.com', 'u1');
    INSERT INTO gsc_tracker_keywords (id, project_id, site_id, query, target_url)
      VALUES ('k1', 'p1', 's1', 'running shoes', 'https://example.com/a'),
             ('k2', 'p1', 's1', 'boots', 'https://example.com/b');
    INSERT INTO rank_tracking_configs VALUES
      ('c1', 'p1', 'www.example.com', 2616, 'pl', NULL, 'both', 1, '2026-01-01'),
      ('c2', 'p1', 'other.com', 2616, 'pl', NULL, 'desktop', 1, '2026-01-02'),
      ('c3', 'p2', 'example.com', 2616, 'pl', NULL, 'both', 1, '2026-01-03');
    INSERT INTO rank_tracking_keywords VALUES ('t1', 'c1', 'Running Shoes');
    INSERT INTO rank_check_runs VALUES ('r1', 'c1'), ('r2', 'c1');
    INSERT INTO rank_snapshots
      (run_id, tracking_keyword_id, keyword, device, position, url, checked_at) VALUES
      ('r1', 't1', 'running shoes', 'mobile', 7, 'https://example.com/a', '2026-11-02T06:00:00Z'),
      ('r1', 't1', 'running shoes', 'desktop', 9, 'https://example.com/a', '2026-11-02T06:00:00Z'),
      ('r2', 't1', 'running shoes', 'mobile', 5, 'https://example.com/a', '2026-11-02T18:00:00Z'),
      ('r2', 't1', 'running shoes', 'mobile', NULL, NULL, '2026-11-03T06:00:00Z'),
      ('r2', 't1', 'running shoes', 'mobile', 1, NULL, '2026-10-30T06:00:00Z');
  `);
  const site = await sites.get("s1");
  if (!site) throw new Error("no site");
  const range = { from: "2026-11-01", to: "2026-11-30" };

  // Unlinked: the project's domains only, the matching one suggested.
  const unlinked = await rank.getRankComparison({ site, ...range });
  expect(unlinked.link).toBeNull();
  expect(unlinked.configs.map((config) => config.id)).toEqual(["c2", "c1"]);
  expect(unlinked.suggested).toBe("c1");

  await expect(rank.saveLink(site, { configId: "c3" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await rank.saveLink(site, { configId: "c1", device: "mobile" });
  const linked = await rank.getRankComparison({
    site: (await sites.get("s1")) ?? site,
    ...range,
  });
  expect(linked.link).toMatchObject({ configId: "c1", device: "mobile" });
  // A later check the same day wins; days outside the month don't show.
  expect(linked.keywords.k1).toEqual({
    trackingKeywordId: "t1",
    days: {
      "2026-11-02": { position: 5, url: "https://example.com/a" },
      "2026-11-03": { position: null, url: null },
    },
  });
  // Not tracked in the linked domain.
  expect(linked.keywords.k2).toEqual({ trackingKeywordId: null, days: {} });

  // Desktop reads the desktop checks.
  await rank.saveLink(site, { configId: "c1", device: "desktop" });
  const desktop = await rank.getRankComparison({
    site: (await sites.get("s1")) ?? site,
    ...range,
  });
  expect(desktop.keywords.k1?.days["2026-11-02"]?.position).toBe(9);
});
