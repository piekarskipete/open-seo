import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { runBatch } from "@/db/runBatch";
import type * as AlertModule from "./GscTrackerAlertService";
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
const directory = mkdtempSync(join(tmpdir(), "gsc-tracker-alerts-"));
let alerts: typeof AlertModule.GscTrackerAlertService;
let sites: typeof SiteModule.GscTrackerRepository;
type Build = Parameters<typeof runBatch>[0];

// What the webhook receives, and how it answers.
const posts: { body: string; headers: Record<string, string> }[] = [];
let answer = 200;

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      posts.push({
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      });
      return new Response("", { status: answer });
    }),
  );
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
    "drizzle/sqlite/0079_gsc_tracker_url_groups.sql",
    "drizzle/sqlite/0080_gsc_tracker_overview_settings.sql",
    "drizzle/sqlite/0081_gsc_tracker_rank_link.sql",
    "drizzle/sqlite/0082_gsc_tracker_alerts.sql",
  ])
    await client.executeMultiple(
      readFileSync(file, "utf8").split("--> statement-breakpoint").join("\n"),
    );
  ({ GscTrackerAlertService: alerts } =
    await import("./GscTrackerAlertService"));
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));

  // The newest stored day is Nov 10, so rules look at the settled Nov 8.
  // "shoes" drops from 3 to 12 that day, "boots" climbs from 15 to 6, and
  // the site's clicks halve week over week.
  const days: string[] = [];
  for (let day = 1; day <= 8; day++) days.push(`2026-11-0${day}`);
  const keywordDays = days.flatMap((date) => {
    const last = date === "2026-11-08";
    return [
      `('k1', '${date}', 1, 1, 20, ${last ? 12 : 3})`,
      `('k2', '${date}', 2, 1, 20, ${last ? 6 : 15})`,
    ];
  });
  const totals: string[] = [];
  for (let back = 0; back < 14; back++) {
    const date = new Date(Date.UTC(2026, 10, 8 - back))
      .toISOString()
      .slice(0, 10);
    totals.push(`('p1', 's1', '${date}', ${back < 7 ? 5 : 10}, 100, 4)`);
  }
  await client.executeMultiple(`
    INSERT INTO gsc_tracker_sites
      (id, project_id, organization_id, site_url, enabled_by_user_id, newest_date, last_error)
      VALUES ('s1', 'p1', 'org1', 'sc-domain:example.com', 'u1', '2026-11-10', 'Search Console didn''t answer.');
    INSERT INTO gsc_tracker_pages (id, project_id, site_id, url) VALUES
      (1, 'p1', 's1', 'https://x/a/'), (2, 'p1', 's1', 'https://x/b/');
    INSERT INTO gsc_tracker_keywords (id, project_id, site_id, query, target_url)
      VALUES ('k1', 'p1', 's1', 'shoes', 'https://x/a'),
             ('k2', 'p1', 's1', 'boots', 'https://x/b');
    INSERT INTO gsc_tracker_keyword_days
      (keyword_id, date, page_id, clicks, impressions, position) VALUES
      ${keywordDays.join(",\n")};
    INSERT INTO gsc_tracker_totals (project_id, site_id, date, clicks, impressions, position) VALUES
      ${totals.join(",\n")};
  `);
});

afterAll(() => {
  vi.unstubAllGlobals();
  client.close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});

it("raises each alert once, signed, and retries a failed digest", async () => {
  const site = await sites.get("s1");
  if (!site) throw new Error("no site");
  const now = new Date("2026-11-11T12:00:00Z");
  const { id: webhookId } = await alerts.saveWebhook(site, {
    name: "n8n",
    url: "https://hooks.example.com/gsc",
    secret: "sek",
    format: "json",
    mode: "instant",
  });
  await expect(
    alerts.saveWebhook(site, {
      name: "bad",
      url: "ftp://x",
      format: "json",
      mode: "instant",
    }),
  ).rejects.toThrow("http");

  // The test POST.
  expect(await alerts.testWebhook(site, webhookId)).toMatchObject({
    ok: true,
    status: 200,
  });
  posts.length = 0;

  expect(await alerts.addRecommended(site, webhookId)).toEqual({ added: 5 });
  expect(await alerts.addRecommended(site, webhookId)).toEqual({ added: 0 });

  // Phrase drop, phrase in the top 10, site traffic drop, sync problem; no
  // page groups, so no group alert.
  expect(await alerts.runSiteAlerts("s1", { now })).toBe(4);
  const titles = posts.map(
    (post) =>
      (JSON.parse(post.body) as { alerts: { title: string }[] }).alerts[0]
        ?.title,
  );
  expect(titles).toEqual(
    expect.arrayContaining([
      "“shoes” dropped 9 places",
      "“boots” reached the top 10",
      "sc-domain:example.com lost 50% of its clicks",
      "sc-domain:example.com: Search Console sync failed",
    ]),
  );
  // Signed with the webhook's secret.
  const first = posts[0];
  expect(first?.headers["x-gsc-tracker-signature"]).toBe(
    `sha256=${createHmac("sha256", "sek")
      .update(first?.body ?? "")
      .digest("hex")}`,
  );

  // Nothing new on the same day.
  posts.length = 0;
  expect(await alerts.runSiteAlerts("s1", { now })).toBe(0);
  expect(posts).toHaveLength(0);

  // A digest that fails stays undelivered and goes again on the next run.
  await client.executeMultiple(`
    DELETE FROM gsc_tracker_alert_events;
    UPDATE gsc_tracker_webhooks SET mode = 'digest';
  `);
  answer = 500;
  expect(await alerts.runSiteAlerts("s1", { now, force: true })).toBe(4);
  expect(posts).toHaveLength(1);
  expect(
    (JSON.parse(posts[0]?.body ?? "{}") as { alerts: unknown[] }).alerts,
  ).toHaveLength(4);
  let state = await alerts.getAlerts(site);
  expect(state.history.every((event) => event.status === "failed")).toBe(true);
  expect(state.webhooks[0]).toMatchObject({
    hasSecret: true,
    lastStatus: 500,
  });

  answer = 200;
  await alerts.runSiteAlerts("s1", { now });
  state = await alerts.getAlerts(site);
  expect(state.history.every((event) => event.status === "sent")).toBe(true);
});

it("checks a rule's thresholds and scope", async () => {
  const site = await sites.get("s1");
  if (!site) throw new Error("no site");
  const [webhook] = (await alerts.getAlerts(site)).webhooks;
  if (!webhook) throw new Error("no webhook");
  // A drop of 9 places doesn't reach a 10-place threshold.
  const { id } = await alerts.saveRule(site, {
    type: "phrase_dropped",
    webhookId: webhook.id,
    params: { places: 10, groupId: "ignored for phrase rules" },
    active: true,
    cooldownDays: 3,
  });
  const rule = (await alerts.getAlerts(site)).rules.find(
    (item) => item.id === id,
  );
  expect(rule?.params).toEqual({ places: 10, minImpressions: 10 });
  await client.execute(
    `DELETE FROM gsc_tracker_alert_rules WHERE id != '${id}'`,
  );
  await client.execute("DELETE FROM gsc_tracker_alert_events");
  expect(
    await alerts.runSiteAlerts("s1", {
      now: new Date("2026-11-11T12:00:00Z"),
      force: true,
    }),
  ).toBe(0);
  await expect(
    alerts.saveRule(site, {
      type: "phrase_dropped",
      webhookId: webhook.id,
      params: { tagId: "missing" },
      active: true,
      cooldownDays: 3,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
