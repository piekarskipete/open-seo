import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as ServiceModule from "./GscTrackerService";
import type * as SiteModule from "../repositories/GscTrackerRepository";
import type * as KeywordModule from "./GscTrackerKeywordService";
import type * as TrackModule from "./gscTrackerTrackQueries";
import type * as TagModule from "./GscTrackerTagService";

type Row = {
  keys: string[];
  clicks: number;
  impressions: number;
  position: number;
};

const gsc = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getPerformance: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: gsc,
  isExpectedGrantFailure: () => false,
}));
vi.mock("./gscTrackerAccess", () => ({
  // Each site's request, as Search Console would answer it for its property.
  querySite: (site: { projectId: string; siteUrl: string }, input: object) =>
    gsc.getPerformance({
      ...input,
      projectId: site.projectId,
      siteUrl: site.siteUrl,
    }),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/features/google/googleAccess", () => ({
  getGoogleAccessMode: async () => "own_client",
}));

let client: Client;
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-track-"));
let service: typeof ServiceModule.GscTrackerService;
let sites: typeof SiteModule.GscTrackerRepository;
let keywords: typeof KeywordModule.GscTrackerKeywordService;
let trackQueries: typeof TrackModule.trackQueries;
let tags: typeof TagModule.GscTrackerTagService;
type Build = Parameters<typeof runBatch>[0];

// What Search Console "returns" per day, by query and page.
let dayRows: (date: string) => Row[] = () => [];
// What it returns for the followed-phrase request of a day.
let phraseRows: (date: string) => Row[] = () => [];

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
    INSERT INTO projects VALUES ('p1');
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
  ({ GscTrackerService: service } = await import("./GscTrackerService"));
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));
  ({ GscTrackerKeywordService: keywords } =
    await import("./GscTrackerKeywordService"));
  ({ trackQueries } = await import("./gscTrackerTrackQueries"));
  ({ GscTrackerTagService: tags } = await import("./GscTrackerTagService"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

/** The project's first site, as the migration makes it: id = project id. */
async function enableSite() {
  const site = await sites.create({
    id: "p1",
    projectId: "p1",
    organizationId: "org1",
    siteUrl: "sc-domain:example.com",
    enabledByUserId: "u1",
  });
  await service.syncNow(site);
}

beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM gsc_tracker_keyword_tags; DELETE FROM gsc_tracker_tags; DELETE FROM gsc_tracker_keyword_days; DELETE FROM gsc_tracker_keywords; DELETE FROM gsc_tracker_rows; DELETE FROM gsc_tracker_totals; DELETE FROM gsc_tracker_queries; DELETE FROM gsc_tracker_pages; DELETE FROM gsc_tracker_sites;",
  );
  gsc.getConnection.mockResolvedValue({ siteUrl: "sc-domain:example.com" });
  gsc.getPerformance.mockImplementation(
    async (input: {
      startDate: string;
      endDate: string;
      dimensions: string[];
      regexFilters?: unknown[];
    }) => {
      if (input.regexFilters) return { rows: phraseRows(input.startDate) };
      if (input.dimensions[0] === "date") {
        // Totals: one row per day of the batch.
        const rows: Row[] = [];
        for (let d = input.startDate; d <= input.endDate; ) {
          const day = dayRows(d);
          rows.push({
            keys: [d],
            clicks: day.reduce((sum, row) => sum + row.clicks, 0) + 1,
            impressions:
              day.reduce((sum, row) => sum + row.impressions, 0) + 10,
            position: 5,
          });
          const next = new Date(`${d}T00:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          d = next.toISOString().slice(0, 10);
        }
        return { rows };
      }
      return { rows: dayRows(input.startDate) };
    },
  );
});

it("follows selected queries with their top page, tags, start and checkpoints", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = () => [
      {
        keys: ["shoes", "https://x/a"],
        clicks: 1,
        impressions: 50,
        position: 4,
      },
      {
        keys: ["shoes", "https://x/b"],
        clicks: 3,
        impressions: 20,
        position: 6,
      },
      {
        keys: ["boots", "https://x/a"],
        clicks: 2,
        impressions: 20,
        position: 5,
      },
    ];
    await enableSite();

    // "shoes" goes with page b (more clicks); "socks" has no page.
    const result = await trackQueries({
      siteId: "p1",
      queries: ["shoes", "Boots", "socks"],
      days: 7,
      tags: ["Blog"],
      startDate: "2026-11-01",
      checkpoints: ["2026-11-05"],
    });
    expect(result).toMatchObject({
      added: 2,
      alreadyFollowed: 0,
      withoutPage: 1,
      updated: 2,
    });
    const month = await keywords.getMonth("p1", "2026-11");
    const [blog] = await tags.list("p1");
    expect(
      month.keywords.map((k) => [
        k.query,
        k.targetUrl,
        k.tagIds,
        k.startDate,
        k.checkpoints,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["shoes", "https://x/b", [blog?.id], "2026-11-01", ["2026-11-05"]],
        ["boots", "https://x/a", [blog?.id], "2026-11-01", ["2026-11-05"]],
      ]),
    );

    // A URL filter picks the target among matching pages only.
    const filtered = await trackQueries({
      siteId: "p1",
      queries: ["shoes"],
      days: 7,
      page: "/A",
    });
    expect(filtered).toMatchObject({ added: 1, alreadyFollowed: 0 });
  } finally {
    vi.useRealTimers();
  }
});
