import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as ServiceModule from "./GscTrackerService";
import type * as SiteModule from "../repositories/GscTrackerRepository";

type Row = {
  keys: string[];
  clicks: number;
  impressions: number;
  position: number;
};

const gsc = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getPerformance: vi.fn(),
  listSitesForUserWithGrantStatus: vi.fn(),
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
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-sites-"));
let service: typeof ServiceModule.GscTrackerService;
let sites: typeof SiteModule.GscTrackerRepository;
type Build = Parameters<typeof runBatch>[0];

// What Search Console "returns" per day, by query and page.
let dayRows: (date: string, siteUrl?: string) => Row[] = () => [];
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
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ GscTrackerService: service } = await import("./GscTrackerService"));
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));
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

async function siteP1() {
  const site = await sites.get("p1");
  if (!site) throw new Error("site p1 missing");
  return site;
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
      siteUrl?: string;
    }) => {
      if (input.regexFilters) return { rows: phraseRows(input.startDate) };
      if (input.dimensions[0] === "date") {
        // Totals: one row per day of the batch.
        const rows: Row[] = [];
        for (let d = input.startDate; d <= input.endDate; ) {
          const day = dayRows(d, input.siteUrl);
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
      return { rows: dayRows(input.startDate, input.siteUrl) };
    },
  );
});

it("keeps each tracked site's history apart", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = (_date, siteUrl) =>
      siteUrl === "https://other.example/"
        ? [
            {
              keys: ["boots", "https://other.example/a"],
              clicks: 2,
              impressions: 20,
              position: 3,
            },
          ]
        : [
            {
              keys: ["shoes", "https://x/a"],
              clicks: 1,
              impressions: 10,
              position: 2,
            },
          ];
    await enableSite();
    // A second property, reached through a member's own Google account.
    gsc.listSitesForUserWithGrantStatus.mockResolvedValue({
      accounts: [
        {
          accountId: "acc1",
          kind: "google_account",
          email: "me@example.com",
          sites: [
            { siteUrl: "https://other.example/", permissionLevel: "siteOwner" },
          ],
        },
      ],
    });
    const { id } = await service.addSite({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
      siteUrl: "https://other.example/",
      accountId: "acc1",
    });

    const listed = await service.listSites("p1");
    // Sites added in the same second come back by URL.
    expect(listed.map((site) => [site.siteUrl, site.accountEmail])).toEqual([
      ["https://other.example/", "me@example.com"],
      ["sc-domain:example.com", null],
    ]);
    const first = await service.compareQueries({ siteId: "p1", days: 7 });
    const second = await service.compareQueries({ siteId: id, days: 7 });
    expect(first?.rows.map((row) => row.key)).toEqual(["shoes"]);
    expect(second?.rows.map((row) => row.key)).toEqual(["boots"]);

    // A property the account can't reach is refused.
    await expect(
      service.addSite({
        projectId: "p1",
        organizationId: "org1",
        userId: "u1",
        siteUrl: "https://nope.example/",
        accountId: "acc1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Removing one site leaves the other's history alone.
    await service.removeSite(await siteP1());
    expect(
      (await service.compareQueries({ siteId: id, days: 7 }))?.rows,
    ).toHaveLength(1);
    expect(await service.listSites("p1")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
