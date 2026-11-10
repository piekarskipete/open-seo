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
    "drizzle/sqlite/0070_gsc_tracker_keywords.sql",
    "drizzle/sqlite/0071_gsc_tracker_explorer_sort.sql",
    "drizzle/sqlite/0072_gsc_tracker_keyword_targets.sql",
    "drizzle/sqlite/0073_gsc_tracker_date_format.sql",
    "drizzle/sqlite/0074_gsc_tracker_keyword_start.sql",
    "drizzle/sqlite/0075_gsc_tracker_tags.sql",
    "drizzle/sqlite/0076_gsc_tracker_checkpoints.sql",
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
    "DELETE FROM gsc_tracker_keyword_tags; DELETE FROM gsc_tracker_tags; DELETE FROM gsc_tracker_keywords; DELETE FROM gsc_tracker_projects;",
  );
  await client.executeMultiple(`
    INSERT INTO gsc_tracker_projects (project_id, organization_id, site_url, enabled_by_user_id)
      VALUES ('p1', 'org1', 'sc-domain:example.com', 'u1');
    INSERT INTO gsc_tracker_keywords (id, project_id, query, target_url) VALUES
      ('k1', 'p1', 'shoes', 'https://x/a'),
      ('k2', 'p1', 'boots', 'https://x/b'),
      ('k3', 'p1', 'socks', 'https://x/c'),
      ('other', 'p2', 'hats', 'https://y/a');
  `);
});

it("creates tags with unique names and tags phrases in bulk", async () => {
  const created = await tags.create({
    projectId: "p1",
    name: "  Blog   posts ",
    color: "green",
  });
  // Names are trimmed, and a second tag can't take the same name.
  await expect(
    tags.create({ projectId: "p1", name: "blog posts", color: "red" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const priority = await tags.create({
    projectId: "p1",
    name: "Priority",
    color: "red",
  });

  // Phrases of another project are ignored; adding twice changes nothing.
  await tags.setOnKeywords({
    projectId: "p1",
    tagId: created.id,
    keywordIds: ["k1", "k2", "other"],
    action: "add",
  });
  await tags.setOnKeywords({
    projectId: "p1",
    tagId: created.id,
    keywordIds: ["k1"],
    action: "add",
  });
  await tags.setOnKeywords({
    projectId: "p1",
    tagId: priority.id,
    keywordIds: ["k1"],
    action: "add",
  });
  expect(await tags.list("p1")).toEqual([
    { id: created.id, name: "Blog posts", color: "green", phrases: 2 },
    { id: priority.id, name: "Priority", color: "red", phrases: 1 },
  ]);

  const month = await keywords.getMonth("p1", "2026-11");
  const byQuery = new Map(month.keywords.map((k) => [k.query, k.tagIds]));
  expect(byQuery.get("shoes")).toHaveLength(2);
  expect(byQuery.get("shoes")).toEqual(
    expect.arrayContaining([created.id, priority.id]),
  );
  expect(byQuery.get("boots")).toEqual([created.id]);
  expect(byQuery.get("socks")).toEqual([]);

  await tags.setOnKeywords({
    projectId: "p1",
    tagId: created.id,
    keywordIds: ["k1", "k2"],
    action: "remove",
  });
  expect((await tags.list("p1"))[0]?.phrases).toBe(0);
});

it("renames, recolors and deletes a tag, and drops tags with the tracker", async () => {
  const { id } = await tags.create({
    projectId: "p1",
    name: "Blog",
    color: "blue",
  });
  await tags.create({ projectId: "p1", name: "Shop", color: "teal" });
  await expect(
    tags.update({ projectId: "p1", id, name: "shop" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await tags.update({ projectId: "p1", id, name: "Guides", color: "violet" });
  expect((await tags.list("p1")).map((tag) => [tag.name, tag.color])).toEqual([
    ["Guides", "violet"],
    ["Shop", "teal"],
  ]);

  await tags.setOnKeywords({
    projectId: "p1",
    tagId: id,
    keywordIds: ["k1"],
    action: "add",
  });
  await tags.remove("p1", id);
  expect((await tags.list("p1")).map((tag) => tag.name)).toEqual(["Shop"]);
  const left = await client.execute(
    "SELECT count(*) AS n FROM gsc_tracker_keyword_tags",
  );
  expect(left.rows[0]?.n).toBe(0);

  // Stopping tracking deletes the project's tags too.
  await tracker.remove("p1");
  expect(await tags.list("p1")).toEqual([]);
});
