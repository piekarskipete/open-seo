import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as ServiceModule from "./GscTrackerService";

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
type Build = Parameters<typeof runBatch>[0];

// What Search Console "returns" per day, by query and page.
let dayRows: (date: string) => Row[] = () => [];

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
  await client.executeMultiple(
    readFileSync("drizzle/sqlite/0069_gsc_tracker.sql", "utf8")
      .split("--> statement-breakpoint")
      .join("\n"),
  );
  ({ GscTrackerService: service } = await import("./GscTrackerService"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(async () => {
  await client.executeMultiple(
    "DELETE FROM gsc_tracker_rows; DELETE FROM gsc_tracker_totals; DELETE FROM gsc_tracker_queries; DELETE FROM gsc_tracker_pages; DELETE FROM gsc_tracker_projects;",
  );
  gsc.getConnection.mockResolvedValue({ siteUrl: "sc-domain:example.com" });
  gsc.getPerformance.mockImplementation(
    async (input: {
      startDate: string;
      endDate: string;
      dimensions: string[];
    }) => {
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

    const list = await service.compareBy({
      projectId: "p1",
      days: 7,
      dimension: "query",
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

    // 3 days: 11-06..11-08 against 11-03..11-05. "socks" is lost.
    const short = await service.compareBy({
      projectId: "p1",
      days: 3,
      dimension: "query",
    });
    const socks = short?.rows.find((row) => row.key === "socks");
    expect(socks?.current.clicks).toBe(0);
    expect(socks?.previous.clicks).toBe(6);
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
    const list = await service.compareBy({
      projectId: "p1",
      days: 28,
      dimension: "query",
    });
    expect(list?.rows).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
