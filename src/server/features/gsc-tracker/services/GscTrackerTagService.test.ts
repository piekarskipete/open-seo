import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as TagModule from "./GscTrackerTagService";
import type * as KeywordModule from "./GscTrackerKeywordService";
import type * as RepositoryModule from "../repositories/GscTrackerRepository";

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
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-tags-"));
let tags: typeof TagModule.GscTrackerTagService;
let keywords: typeof KeywordModule.GscTrackerKeywordService;
let tracker: typeof RepositoryModule.GscTrackerRepository;
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
    "drizzle/sqlite/0071_gsc_tracker_keywords.sql",
    "drizzle/sqlite/0072_gsc_tracker_explorer_sort.sql",
    "drizzle/sqlite/0073_gsc_tracker_keyword_targets.sql",
    "drizzle/sqlite/0074_gsc_tracker_date_format.sql",
    "drizzle/sqlite/0075_gsc_tracker_keyword_start.sql",
    "drizzle/sqlite/0076_gsc_tracker_tags.sql",
    "drizzle/sqlite/0077_gsc_tracker_checkpoints.sql",
    "drizzle/sqlite/0078_gsc_tracker_sites.sql",
    "drizzle/sqlite/0079_gsc_tracker_drop_projects.sql",
    "drizzle/sqlite/0080_gsc_tracker_url_groups.sql",
    "drizzle/sqlite/0081_gsc_tracker_overview_settings.sql",
    "drizzle/sqlite/0082_gsc_tracker_rank_link.sql",
    "drizzle/sqlite/0083_gsc_tracker_alerts.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ GscTrackerTagService: tags } = await import("./GscTrackerTagService"));
  ({ GscTrackerKeywordService: keywords } =
    await import("./GscTrackerKeywordService"));
  ({ GscTrackerRepository: tracker } =
    await import("../repositories/GscTrackerRepository"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM gsc_tracker_keyword_tags; DELETE FROM gsc_tracker_tags; DELETE FROM gsc_tracker_keywords; DELETE FROM gsc_tracker_sites;",
  );
  await client.executeMultiple(`
    INSERT INTO gsc_tracker_sites (id, project_id, organization_id, site_url, enabled_by_user_id)
      VALUES ('p1', 'p1', 'org1', 'sc-domain:example.com', 'u1'),
             ('p2', 'p2', 'org1', 'sc-domain:other.com', 'u1');
    INSERT INTO gsc_tracker_keywords (id, project_id, site_id, query, target_url) VALUES
      ('k1', 'p1', 'p1', 'shoes', 'https://x/a'),
      ('k2', 'p1', 'p1', 'boots', 'https://x/b'),
      ('k3', 'p1', 'p1', 'socks', 'https://x/c'),
      ('other', 'p2', 'p2', 'hats', 'https://y/a');
  `);
});

it("adds tags by name to selected phrases, creating new ones once", async () => {
  // Names are trimmed and matched without case; other projects' phrases
  // are ignored.
  await tags.applyToKeywords({
    siteId: "p1",
    keywordIds: ["k1", "k2", "other"],
    addTags: ["  Blog   posts ", "blog posts"],
  });
  await tags.applyToKeywords({
    siteId: "p1",
    keywordIds: ["k1"],
    addTags: ["BLOG POSTS", "Priority"],
  });
  const listed = await tags.list("p1");
  expect(
    listed.map((tag) => [tag.name, tag.normalizedName, tag.keywordCount]),
  ).toEqual([
    ["Blog posts", "blog posts", 2],
    ["Priority", "priority", 1],
  ]);
  const [blog, priority] = listed;
  if (!blog || !priority) throw new Error("tags missing");

  const month = await keywords.getMonth("p1", "2026-11");
  const byQuery = new Map(month.keywords.map((k) => [k.query, k.tagIds]));
  expect(byQuery.get("shoes")).toHaveLength(2);
  expect(byQuery.get("shoes")).toEqual(
    expect.arrayContaining([blog.id, priority.id]),
  );
  expect(byQuery.get("boots")).toEqual([blog.id]);
  expect(byQuery.get("socks")).toEqual([]);

  await tags.applyToKeywords({
    siteId: "p1",
    keywordIds: ["k1", "k2"],
    removeTagIds: [blog.id],
  });
  expect((await tags.list("p1"))[0]?.keywordCount).toBe(0);
});

it("renames, recolors and deletes a tag, and drops tags with the tracker", async () => {
  await tags.applyToKeywords({
    siteId: "p1",
    keywordIds: ["k1"],
    addTags: ["Blog", "Shop"],
  });
  const [blog] = await tags.list("p1");
  if (!blog) throw new Error("tag missing");
  await expect(
    tags.update({ siteId: "p1", id: blog.id, name: "shop" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await tags.update({
    siteId: "p1",
    id: blog.id,
    name: "Guides",
    color: "violet",
  });
  expect(
    (await tags.list("p1")).map((tag) => [tag.name, tag.color]),
  ).toContainEqual(["Guides", "violet"]);

  await tags.remove("p1", blog.id);
  expect((await tags.list("p1")).map((tag) => tag.name)).toEqual(["Shop"]);
  const left = await client.execute(
    "SELECT count(*) AS n FROM gsc_tracker_keyword_tags",
  );
  expect(left.rows[0]?.n).toBe(1);

  // Stopping tracking deletes the project's tags too.
  await tracker.remove("p1");
  expect(await tags.list("p1")).toEqual([]);
});
