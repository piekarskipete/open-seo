import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as ServiceModule from "./GscTrackerService";
import type * as KeywordModule from "./GscTrackerKeywordService";

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
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
  getOptionalEnvValue: async () => undefined,
}));
vi.mock("@/server/features/google/googleAccess", () => ({
  getGoogleAccessMode: async () => "own_client",
}));

let client: Client;
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-"));
let service: typeof ServiceModule.GscTrackerService;
let keywords: typeof KeywordModule.GscTrackerKeywordService;
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
    "drizzle/sqlite/0071_gsc_tracker_keywords.sql",
    "drizzle/sqlite/0072_gsc_tracker_explorer_sort.sql",
    "drizzle/sqlite/0073_gsc_tracker_keyword_targets.sql",
    "drizzle/sqlite/0074_gsc_tracker_date_format.sql",
    "drizzle/sqlite/0075_gsc_tracker_keyword_start.sql",
    "drizzle/sqlite/0076_gsc_tracker_tags.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ GscTrackerService: service } = await import("./GscTrackerService"));
  ({ GscTrackerKeywordService: keywords } =
    await import("./GscTrackerKeywordService"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM gsc_tracker_keyword_tags; DELETE FROM gsc_tracker_tags; DELETE FROM gsc_tracker_keyword_days; DELETE FROM gsc_tracker_keywords; DELETE FROM gsc_tracker_rows; DELETE FROM gsc_tracker_totals; DELETE FROM gsc_tracker_queries; DELETE FROM gsc_tracker_pages; DELETE FROM gsc_tracker_projects;",
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

it("stores synced days and compares the current window with the previous one", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    // Newest day 2026-11-08. "shoes" improves, "boots" is new, "socks" is lost.
    dayRows = (date) =>
      date >= "2026-11-05"
        ? [
            {
              keys: ["shoes", "https://x/a"],
              clicks: 4,
              impressions: 40,
              position: 3,
            },
            {
              keys: ["shoes", "https://x/b"],
              clicks: 1,
              impressions: 10,
              position: 8,
            },
            {
              keys: ["boots", "https://x/a"],
              clicks: 2,
              impressions: 20,
              position: 6,
            },
          ]
        : [
            {
              keys: ["shoes", "https://x/a"],
              clicks: 1,
              impressions: 20,
              position: 9,
            },
            {
              keys: ["socks", "https://x/c"],
              clicks: 3,
              impressions: 30,
              position: 4,
            },
          ];
    await service.enable({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
    });

    // The first batch: four recent days plus two older ones.
    const status = await service.getStatus("p1");
    expect(status).toMatchObject({
      enabled: true,
      oldestDate: "2026-11-03",
      newestDate: "2026-11-08",
      lastError: null,
    });

    const list = await service.compareQueries({
      projectId: "p1",
      days: 7,
    });
    const byKey = new Map(list?.rows.map((row) => [row.key, row]));
    // 7-day window 11-02..11-08 holds every stored day; the previous is empty.
    expect(byKey.get("shoes")?.current).toMatchObject({
      clicks: (4 + 1) * 4 + 1 * 2,
      impressions: 50 * 4 + 20 * 2,
    });
    // Position is weighted by impressions: (3*40+8*10)*4 + (9*20)*2 over 240.
    expect(byKey.get("shoes")?.current.position).toBeCloseTo(
      ((3 * 40 + 8 * 10) * 4 + 9 * 20 * 2) / 240,
    );
    expect(byKey.get("socks")?.current.clicks).toBe(6);
    // Pages each query reached in the window.
    expect(byKey.get("shoes")?.urls).toBe(2);
    expect(byKey.get("boots")?.urls).toBe(1);

    // Filtered by URL: only the queries page b earns, with page b's numbers.
    const forPage = await service.compareQueries({
      projectId: "p1",
      days: 7,
      page: "X/B",
    });
    expect(forPage?.rows.map((row) => row.key)).toEqual(["shoes"]);
    // The URL count stays site-wide under a URL filter.
    expect(forPage?.rows[0]?.urls).toBe(2);
    expect(forPage?.rows[0]?.current).toMatchObject({
      clicks: 1 * 4,
      impressions: 10 * 4,
      position: 8,
    });

    // 3 days: 11-06..11-08 against 11-03..11-05. "socks" is lost.
    const short = await service.compareQueries({
      projectId: "p1",
      days: 3,
    });
    const socks = short?.rows.find((row) => row.key === "socks");
    expect(socks?.current.clicks).toBe(0);
    expect(socks?.previous.clicks).toBe(6);
    // Lost queries reached no page in the current window.
    expect(socks?.urls).toBe(0);
    expect(
      short?.rows.find((row) => row.key === "shoes")?.previous.clicks,
    ).toBe(5 + 1 * 2);

    const overview = await service.getOverview("p1", 7);
    expect(overview?.series).toHaveLength(6);
    // Totals come from Search Console's own totals, not summed rows.
    expect(overview?.current.clicks).toBe((7 + 1) * 4 + (4 + 1) * 2);

    const cannibal = await service.getCannibalization("p1", 7);
    expect(cannibal?.queries.map((query) => query.query)).toEqual(["shoes"]);
    expect(cannibal?.queries[0]?.pages.map((page) => page.url)).toEqual([
      "https://x/a",
      "https://x/b",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("starts the history over when the project switches property", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = () => [
      {
        keys: ["shoes", "https://x/a"],
        clicks: 1,
        impressions: 10,
        position: 2,
      },
    ];
    await service.enable({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
    });
    gsc.getConnection.mockResolvedValue({ siteUrl: "https://other.example/" });
    dayRows = () => [];
    await service.syncNow("p1");

    const status = await service.getStatus("p1");
    expect(status.siteUrl).toBe("https://other.example/");
    const list = await service.compareQueries({
      projectId: "p1",
      days: 28,
    });
    expect(list?.rows).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("follows a phrase day by day and marks pages that beat its target", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = () => [];
    // The target ranks every day; another page takes more impressions on the
    // last two days.
    phraseRows = (date) => [
      {
        keys: ["running shoes", "https://x/a/"],
        clicks: 1,
        impressions: 10,
        position: 3.4,
      },
      {
        keys: ["running shoes", "https://x/b"],
        clicks: 0,
        impressions: date >= "2026-11-07" ? 30 : 5,
        position: 8,
      },
    ];
    await service.enable({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
    });
    // Typed by hand: mixed case, extra space, no trailing slash.
    await keywords.add("p1", [
      { query: "Running  Shoes", targetUrl: "https://x/a" },
    ]);

    const month = await keywords.getMonth("p1", "2026-11");
    const [phrase] = month.keywords;
    expect(phrase?.query).toBe("running shoes");
    // One request per day, recent days first: 11-01 to 11-08 in the first batch.
    expect(Object.keys(phrase?.pages[0]?.days ?? {})).toHaveLength(8);
    expect(
      phrase?.pages.map((page) => [page.url, page.isTarget, page.stronger]),
    ).toEqual([
      ["https://x/a/", true, false],
      ["https://x/b", false, true],
    ]);
    expect(phrase?.pages[0]?.days["2026-11-08"]?.position).toBe(3.4);
    expect(phrase?.cannibalized).toBe(true);
    expect(phrase?.competingPages).toBe(1);
    expect(phrase?.outrankedDays).toEqual(["2026-11-07", "2026-11-08"]);
  } finally {
    vi.useRealTimers();
  }
});

it("follows one phrase for two URLs as two entries, each with the day's pages", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = () => [];
    phraseRows = () => [
      {
        keys: ["rebusy", "https://x/a/"],
        clicks: 2,
        impressions: 20,
        position: 2,
      },
      {
        keys: ["rebusy", "https://x/b/"],
        clicks: 1,
        impressions: 10,
        position: 6,
      },
    ];
    await service.enable({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
    });
    const first = await keywords.add("p1", [
      { query: "rebusy", targetUrl: "https://x/a/" },
      { query: "rebusy", targetUrl: "https://x/b/" },
    ]);
    expect(first).toEqual({ added: 2, skipped: 0 });
    // The same pair again, typed differently, is already followed.
    const again = await keywords.add("p1", [
      { query: "Rebusy", targetUrl: "http://www.x/a" },
    ]);
    expect(again).toEqual({ added: 0, skipped: 1 });

    const month = await keywords.getMonth("p1", "2026-11");
    expect(
      month.keywords.map((phrase) => [
        phrase.targetUrl,
        phrase.pages.find((page) => page.isTarget)?.position,
        phrase.cannibalized,
      ]),
    ).toEqual([
      ["https://x/a/", 2, false],
      ["https://x/b/", 6, true],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("shows a phrase's start, last month and latest positions with their moves", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z"), toFake: ["Date"] });
  try {
    dayRows = () => [];
    // October at 5; November at 3, improving to 2 on its last measured day.
    phraseRows = (date) => [
      {
        keys: ["rebusy", "https://x/a/"],
        clicks: 1,
        impressions: 10,
        position: date < "2026-11-01" ? 5 : date === "2026-11-08" ? 2 : 3,
      },
    ];
    await service.enable({
      projectId: "p1",
      organizationId: "org1",
      userId: "u1",
    });
    await keywords.add("p1", [{ query: "rebusy", targetUrl: "https://x/a/" }]);
    // Each sync fetches eight more days; four reach back into October.
    for (let i = 0; i < 4; i++) await service.syncNow("p1");
    const [{ id } = { id: "" }] = (await keywords.getMonth("p1", "2026-11"))
      .keywords;
    await keywords.setStartDate({
      projectId: "p1",
      id,
      startDate: "2026-10-20",
    });

    const [phrase] = (await keywords.getMonth("p1", "2026-11")).keywords;
    expect(phrase).toMatchObject({
      startDate: "2026-10-20",
      startIsDefault: false,
      start: { date: "2026-10-20", position: 5 },
      latest: { date: "2026-11-08", position: 2, change: 1 },
    });
    expect(phrase?.lastMonth?.position).toBe(5);
    // November averages (3 * 7 + 2) / 8; last month was 5.
    expect(phrase?.lastMonth?.change).toBeCloseTo(5 - (3 * 7 + 2) / 8);
  } finally {
    vi.useRealTimers();
  }
});
