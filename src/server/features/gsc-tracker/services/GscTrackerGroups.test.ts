import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as GroupServiceModule from "./GscTrackerGroupService";
import type * as PageSyncModule from "./gscTrackerPageSync";
import type * as RulesModule from "./gscTrackerGroupRules";
import type * as SiteModule from "../repositories/GscTrackerRepository";

type Row = {
  keys: string[];
  clicks: number;
  impressions: number;
  position: number;
};

const google = vi.hoisted(() => ({ query: vi.fn() }));
const sitemap = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getConnection: vi.fn() },
  isExpectedGrantFailure: () => false,
}));
vi.mock("./gscTrackerAccess", () => ({
  querySite: async (_site: unknown, input: object) => ({
    rows: (await google.query(input)) as Row[],
  }),
}));
vi.mock("@/server/lib/audit/discovery", () => ({
  collectSitemapUrls: async () => new Set(sitemap.urls),
}));
vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: async () => undefined,
}));

let client: Client;
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-groups-"));
let groups: typeof GroupServiceModule.GscTrackerGroupService;
let pageSync: typeof PageSyncModule;
let rules: typeof RulesModule;
let sites: typeof SiteModule.GscTrackerRepository;
type Build = Parameters<typeof runBatch>[0];

const NOW = new Date("2026-11-11T12:00:00Z");
// The newest day the tracker stores on NOW.
const LATEST = "2026-11-09";

/** Page-only rows Search Console "returns": every day of the request, with
 *  the numbers `pages` gives each URL per day. */
let pages: Record<string, { clicks: number; impressions: number }> = {};
function answer(input: {
  startDate: string;
  endDate: string;
  startRow?: number;
}) {
  if (input.startRow) return [];
  const rows: Row[] = [];
  for (
    let day = new Date(`${input.startDate}T00:00:00Z`);
    day <= new Date(`${input.endDate}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10);
    for (const [url, numbers] of Object.entries(pages))
      rows.push({ keys: [date, url], ...numbers, position: 4 });
  }
  return rows;
}

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
    "drizzle/sqlite/0081_gsc_tracker_overview_settings.sql",
    "drizzle/sqlite/0082_gsc_tracker_rank_link.sql",
    "drizzle/sqlite/0083_gsc_tracker_alerts.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  google.query.mockImplementation(answer);
  ({ GscTrackerGroupService: groups } =
    await import("./GscTrackerGroupService"));
  pageSync = await import("./gscTrackerPageSync");
  rules = await import("./gscTrackerGroupRules");
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

async function site() {
  const found = await sites.get("s1");
  if (found) return found;
  return sites.create({
    id: "s1",
    projectId: "p1",
    organizationId: "org1",
    siteUrl: "https://example.com/",
    enabledByUserId: "u1",
  });
}

async function syncPages() {
  await pageSync.syncPageDays(await site(), NOW);
  return site();
}

describe("rules", () => {
  it("tells a valid regex from an invalid one", () => {
    expect(
      rules.compileGroupRegex("/product/[^/]+/$")?.test("/Product/x/"),
    ).toBe(true);
    expect(rules.compileGroupRegex("(")).toBeNull();
  });

  it("keeps sitemaps on the property's domain", () => {
    const on = (siteUrl: string, sitemapUrl: string) => {
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only siteUrl is read
        rules.requireSitemapUrl({ siteUrl } as never, sitemapUrl);
        return true;
      } catch {
        return false;
      }
    };
    expect(on("sc-domain:example.com", "https://shop.example.com/s.xml")).toBe(
      true,
    );
    expect(on("https://www.example.com/", "https://example.com/s.xml")).toBe(
      true,
    );
    expect(on("https://example.com/", "https://evil.com/s.xml")).toBe(false);
    expect(on("https://example.com/", "ftp://example.com/s.xml")).toBe(false);
  });
});

describe("page groups", () => {
  it("stores page days in one request per run of days", async () => {
    pages = {
      "https://example.com/blog/a/": { clicks: 2, impressions: 20 },
      "https://example.com/blog/b/": { clicks: 1, impressions: 10 },
      "https://example.com/shop/": { clicks: 5, impressions: 50 },
      // Looks like /blog but isn't under it.
      "https://example.com/blogger/": { clicks: 0, impressions: 1 },
    };
    const synced = await syncPages();
    expect(synced.pagesNewestDate).toBe(LATEST);
    // Recent days first, then 30 days in all.
    expect(google.query).toHaveBeenCalledWith(
      expect.objectContaining({ dimensions: ["date", "page"] }),
    );
    const list = await groups.getPages({ site: synced, days: 7 });
    expect(list?.rows.map((row) => row.key)).toEqual([
      "https://example.com/shop/",
      "https://example.com/blog/a/",
      "https://example.com/blog/b/",
      "https://example.com/blogger/",
    ]);
    expect(list?.rows[0].current).toMatchObject({
      clicks: 35,
      impressions: 350,
    });
  });

  it("fills a directory group, adds new pages, and keeps removed ones out", async () => {
    const current = await site();
    const { id } = await groups.createGroup({
      site: current,
      name: "Blog",
      kind: "directory",
      pattern: "/blog/",
    });
    let group = await groups.getGroup(current, id, 7);
    expect(group.urls).toBe(2);
    expect(group.totals?.current).toMatchObject({
      clicks: 21,
      impressions: 210,
    });

    // A new blog page shows up in Search Console and joins on refresh.
    pages["https://example.com/blog/c/"] = { clicks: 1, impressions: 5 };
    await sites.update(current.id, { pagesNewestDate: "2026-11-08" });
    await syncPages();
    await rules.refreshSiteGroups(await site(), NOW);
    group = await groups.getGroup(await site(), id, 7);
    expect(group.urls).toBe(3);

    // Taken out by hand, a rule page stays out.
    await groups.removeUrls(await site(), id, ["https://example.com/blog/c/"]);
    await rules.refreshSiteGroups(await site(), NOW);
    expect((await groups.getGroup(await site(), id, 7)).urls).toBe(2);
    // And comes back when added again.
    await groups.addUrls(await site(), id, ["https://example.com/blog/c/"]);
    expect((await groups.getGroup(await site(), id, 7)).urls).toBe(3);
  });

  it("takes a sitemap's URLs in Search Console's spelling and lists the rest with zeros", async () => {
    sitemap.urls = [
      "https://example.com/shop", // Search Console has it with a slash
      "https://example.com/new-page/",
    ];
    const current = await site();
    const { id } = await groups.createGroup({
      site: current,
      name: "Sitemap",
      kind: "sitemap",
      pattern: "https://example.com/sitemap.xml",
    });
    const list = await groups.getPages({ site: current, days: 7, groupId: id });
    expect(list?.rows.map((row) => [row.key, row.current.clicks])).toEqual([
      ["https://example.com/shop/", 35],
      ["https://example.com/new-page/", 0],
    ]);
    const summary = await groups.listGroups(current, 7);
    expect(summary.groups.map((group) => [group.name, group.urls])).toEqual([
      ["Blog", 3],
      ["Sitemap", 2],
    ]);
  });

  it("refuses a sitemap off the property, a bad regex and a taken name", async () => {
    const current = await site();
    await expect(
      groups.createGroup({
        site: current,
        name: "Other",
        kind: "sitemap",
        pattern: "https://evil.com/sitemap.xml",
      }),
    ).rejects.toThrow("domain");
    await expect(
      groups.createGroup({
        site: current,
        name: "Bad",
        kind: "regex",
        pattern: "(",
      }),
    ).rejects.toThrow("regular expression");
    await expect(
      groups.createGroup({
        site: current,
        name: "Posts",
        kind: "directory",
        pattern: "https://example.com/post-sitemap.xml",
      }),
    ).rejects.toThrow("pick Sitemap");
    await expect(
      groups.createGroup({ site: current, name: "blog", kind: "manual" }),
    ).rejects.toThrow("already exists");
  });

  it("filters pages by a regex and by a pasted URL list", async () => {
    const current = await site();
    const regex = await groups.getPages({
      site: current,
      days: 7,
      filter: { urlMode: "regex", url: "/blog/[ab]/" },
    });
    expect(regex?.rows.map((row) => row.key)).toEqual([
      "https://example.com/blog/a/",
      "https://example.com/blog/b/",
    ]);
    const listed = await groups.getPages({
      site: current,
      days: 7,
      filter: {
        urlMode: "list",
        url: "http://www.example.com/shop\nexample.com/blog/b",
      },
    });
    expect(listed?.rows.map((row) => row.key)).toEqual([
      "https://example.com/shop/",
      "https://example.com/blog/b/",
    ]);
    // A regex group picks the same pages.
    const { id } = await groups.createGroup({
      site: current,
      name: "Posts a and b",
      kind: "regex",
      pattern: "/BLOG/[ab]/$",
    });
    expect((await groups.getGroup(current, id, 7)).urls).toBe(2);
  });

  it("lists a sitemap's URLs through the URL filter, with zeros for pages without data", async () => {
    sitemap.urls = [
      "https://example.com/blog/a", // Search Console spells it with a slash
      "https://example.com/only-in-sitemap/",
    ];
    const list = await groups.getPages({
      site: await site(),
      days: 7,
      filter: {
        urlMode: "sitemap",
        url: "https://example.com/post-sitemap.xml",
      },
    });
    expect(list?.rows.map((row) => [row.key, row.current.clicks])).toEqual([
      ["https://example.com/blog/a/", 14],
      ["https://example.com/only-in-sitemap/", 0],
    ]);
  });
});
