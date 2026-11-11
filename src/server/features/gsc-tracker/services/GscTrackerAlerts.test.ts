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
  ({ GscTrackerAlertService: alerts } =
    await import("./GscTrackerAlertService"));
  ({ GscTrackerRepository: sites } =
    await import("../repositories/GscTrackerRepository"));

  // The newest stored day is Nov 10, so rules look at the settled Nov 8.
  // "shoes" drops from 3 to 15 that day, "boots" climbs from 15 to 2, and
  // the site's clicks fall from 350 to 140 week over week.
  const days: string[] = [];
  for (let day = 1; day <= 8; day++) days.push(`2026-11-0${day}`);
  const keywordDays = days.flatMap((date) => {
    const last = date === "2026-11-08";
    return [
      `('k1', '${date}', 1, 1, 20, ${last ? 15 : 3})`,
      `('k2', '${date}', 2, 1, 20, ${last ? 2 : 15})`,
    ];
  });
  const totals: string[] = [];
  for (let back = 0; back < 14; back++) {
    const date = new Date(Date.UTC(2026, 10, 8 - back))
      .toISOString()
      .slice(0, 10);
    totals.push(`('p1', 's1', '${date}', ${back < 7 ? 20 : 50}, 100, 4)`);
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

  // Phrase drop, phrase in the top 3, site traffic drop, sync problem (no
  // page groups, so no group alert), sent as one summary.
  expect(await alerts.runSiteAlerts("s1", { now })).toBe(4);
  expect(posts).toHaveLength(1);
  const summary = JSON.parse(posts[0]?.body ?? "{}") as {
    event: string;
    summary: string;
    sections: { label: string; lines: string[] }[];
  };
  expect(summary.event).toBe("gsc_tracker.summary");
  expect(summary.sections).toEqual([
    {
      type: "phrase_dropped",
      label: "Phrase dropped",
      count: 1,
      lines: ["shoes: 3 → 15 (−12) · https://x/a"],
    },
    {
      type: "phrase_entered_top",
      label: "Phrase reached the top",
      count: 1,
      lines: ["boots: 15 → 2 · https://x/b"],
    },
    {
      type: "site_traffic_drop",
      label: "Site lost traffic",
      count: 1,
      lines: ["Whole site: 350 → 140 clicks (−60%)"],
    },
    {
      type: "sync_error",
      label: "Sync problem",
      count: 1,
      lines: ["Search Console: Search Console didn't answer."],
    },
  ]);
  expect(summary.summary).toContain(
    "GSC Tracker summary · sc-domain:example.com",
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

  // A summary that fails stays undelivered and goes again on the next run,
  // as a Discord message this time.
  await client.executeMultiple(`
    DELETE FROM gsc_tracker_alert_events;
    UPDATE gsc_tracker_webhooks SET format = 'discord';
  `);
  answer = 500;
  expect(await alerts.runSiteAlerts("s1", { now, force: true })).toBe(4);
  expect(posts).toHaveLength(1);
  const discord = JSON.parse(posts[0]?.body ?? "{}") as {
    content: string;
    flags: number;
  };
  expect(discord.content).toContain("**Phrase dropped (1)**");
  // No link previews: off-site URLs in <…>, and the embeds flag set.
  expect(discord.content).toContain("• shoes: 3 → 15 (−12) · <https://x/a>");
  expect(discord.flags).toBe(4);
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

  // Today's summary went out, so a later alert waits for tomorrow's,
  // unless Check now forces it.
  await client.execute(`
    INSERT INTO gsc_tracker_alert_events (rule_id, site_id, subject, date, title, message, data)
    SELECT id, 's1', 'later', '2026-11-08', 'Later', 'Later', '{"line":"later"}'
    FROM gsc_tracker_alert_rules LIMIT 1
  `);
  posts.length = 0;
  await alerts.runSiteAlerts("s1", { now: new Date() });
  expect(posts).toHaveLength(0);
  await alerts.runSiteAlerts("s1", { now: new Date(), force: true });
  expect(posts).toHaveLength(1);
});

it("checks a rule's thresholds and scope", async () => {
  const site = await sites.get("s1");
  if (!site) throw new Error("no site");
  const [webhook] = (await alerts.getAlerts(site)).webhooks;
  if (!webhook) throw new Error("no webhook");
  // A drop of 12 places doesn't reach a 13-place threshold.
  const { id } = await alerts.saveRule(site, {
    type: "phrase_dropped",
    webhookId: webhook.id,
    params: { places: 13, groupId: "ignored for phrase rules" },
    active: true,
    cooldownDays: 3,
  });
  const rule = (await alerts.getAlerts(site)).rules.find(
    (item) => item.id === id,
  );
  expect(rule?.params).toEqual({ places: 13, minImpressions: 50 });
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
