import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import {
  GscTrackerAlertRepository,
  type GscTrackerWebhook,
} from "../repositories/GscTrackerAlertRepository";
import { describeError } from "@/server/lib/errors";
import { propertyDomain } from "./gscTrackerGroupRules";
import {
  GSC_TRACKER_ALERT_DEFINITIONS,
  GSC_TRACKER_ALERT_TYPES,
} from "@/shared/gsc-tracker-alerts";
import type { GscTrackerAlertType } from "@/shared/gsc-tracker-alerts";

// Sends a site's new alerts to its webhooks as one summary per check:
// sections per rule type, a line per alert with the URL it is about, as
// plain JSON or as a Slack or Discord message, signed with the webhook's
// secret when it has one.

const TIMEOUT_MS = 10_000;
// Alerts per summary POST (and per batch of status updates; D1 binds ~100),
// and lines a section shows before "+N more".
const PER_POST = 90;
const LINES_PER_SECTION = 10;
const DISCORD_LIMIT = 1_900;
const SLACK_LIMIT = 3_500;

type OutgoingAlert = {
  type: GscTrackerAlertType | "test";
  title: string;
  message: string;
  date: string;
  subject: string;
  data: Record<string, unknown>;
};

function lineOf(alert: OutgoingAlert): string {
  return typeof alert.data.line === "string" ? alert.data.line : alert.title;
}

/** The alerts by type, in the order the rule types are listed. */
function sections(alerts: OutgoingAlert[]) {
  const order: (GscTrackerAlertType | "test")[] = [
    "test",
    ...GSC_TRACKER_ALERT_TYPES,
  ];
  return order.flatMap((type) => {
    const items = alerts.filter((alert) => alert.type === type);
    if (items.length === 0) return [];
    const label =
      type === "test" ? "Test" : GSC_TRACKER_ALERT_DEFINITIONS[type].label;
    const lines = items.slice(0, LINES_PER_SECTION).map(lineOf);
    if (items.length > LINES_PER_SECTION)
      lines.push(`+${items.length - LINES_PER_SECTION} more`);
    return [{ type, label, count: items.length, lines }];
  });
}

/** A chat line without link previews: URLs on the site become their path
 *  (/blog/post/), other URLs are wrapped in <…>, which chats don't preview. */
function plainLinks(line: string, site: Pick<GscTrackerSite, "siteUrl">) {
  const domain = propertyDomain(site.siteUrl);
  return line.replace(/https?:\/\/[^\s<>]+/g, (url) => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (domain && (host === domain || host.endsWith(`.${domain}`)))
        return `${parsed.pathname}${parsed.search}` || "/";
    } catch {
      // Not a URL after all: keep it as text.
    }
    return `<${url}>`;
  });
}

/** The summary's text, with `bold` marking headings; `chat` drops links. */
function summaryText(
  site: Pick<GscTrackerSite, "siteUrl">,
  alerts: OutgoingAlert[],
  bold: (text: string) => string,
  limit: number,
  chat = false,
): string {
  const days = alerts
    .map((alert) => alert.date)
    .filter((day) => day.length === 10);
  days.sort();
  const span =
    days.length === 0
      ? ""
      : days[0] === days[days.length - 1]
        ? ` · ${days[0]}`
        : ` · ${days[0]} – ${days[days.length - 1]}`;
  const text = [
    bold(
      `GSC Tracker summary · ${chat ? propertyDomain(site.siteUrl) : site.siteUrl}${span}`,
    ),
    ...sections(alerts).flatMap((section) => [
      "",
      bold(`${section.label} (${section.count})`),
      ...section.lines.map(
        (line) => `• ${chat ? plainLinks(line, site) : line}`,
      ),
    ]),
  ].join("\n");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function body(
  webhook: Pick<GscTrackerWebhook, "format">,
  site: Pick<GscTrackerSite, "id" | "siteUrl">,
  alerts: OutgoingAlert[],
): string {
  if (webhook.format === "slack")
    return JSON.stringify({
      text: summaryText(site, alerts, (text) => `*${text}*`, SLACK_LIMIT, true),
      unfurl_links: false,
      unfurl_media: false,
    });
  if (webhook.format === "discord")
    return JSON.stringify({
      content: summaryText(
        site,
        alerts,
        (text) => `**${text}**`,
        DISCORD_LIMIT,
        true,
      ),
      // SUPPRESS_EMBEDS: no link previews under the message.
      flags: 4,
      allowed_mentions: { parse: [] },
    });
  return JSON.stringify({
    event: "gsc_tracker.summary",
    sentAt: new Date().toISOString(),
    site: { id: site.id, url: site.siteUrl },
    summary: summaryText(
      site,
      alerts,
      (text) => text,
      Number.POSITIVE_INFINITY,
    ),
    sections: sections(alerts),
    alerts,
  });
}

/** HMAC-SHA256 of the body, hex, as `X-GSC-Tracker-Signature: sha256=…`. */
async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** POSTs alerts to a webhook; never throws. */
export async function postAlerts(
  webhook: GscTrackerWebhook,
  site: Pick<GscTrackerSite, "id" | "siteUrl">,
  alerts: OutgoingAlert[],
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const payload = body(webhook, site, alerts);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "OpenSEO-GSC-Tracker",
  };
  if (webhook.secret)
    headers["x-gsc-tracker-signature"] =
      `sha256=${await sign(webhook.secret, payload)}`;
  let result: { ok: boolean; status: number | null; error: string | null };
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    result = {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `The webhook answered ${response.status}.`,
    };
  } catch (error) {
    result = {
      ok: false,
      status: null,
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "The webhook didn't answer within 10 seconds."
          : "The webhook couldn't be reached.",
    };
    console.error("[gsc-tracker] webhook failed", {
      webhookId: webhook.id,
      error: describeError(error),
    });
  }
  await GscTrackerAlertRepository.updateWebhook(webhook.id, {
    lastStatus: result.status,
    lastError: result.error,
    ...(result.ok ? { lastSentAt: new Date().toISOString() } : {}),
  });
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Sends the site's undelivered alerts (failed ones again, up to a few
 *  attempts) to their webhooks. */
/**
 * Sends the site's undelivered alerts to their webhooks as one summary a day
 * each: a webhook that already got today's summary waits for tomorrow,
 * unless `force` (Check now) or a summary is being sent again after failing.
 */
export async function deliverPending(
  site: GscTrackerSite,
  options: { now?: Date; force?: boolean } = {},
): Promise<void> {
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const pending = await GscTrackerAlertRepository.undelivered(site.id);
  if (pending.length === 0) return;
  const webhooks = new Map(
    (await GscTrackerAlertRepository.listWebhooks(site.id)).map((webhook) => [
      webhook.id,
      webhook,
    ]),
  );
  const byWebhook = new Map<string, typeof pending>();
  for (const item of pending)
    byWebhook.set(item.webhookId, [
      ...(byWebhook.get(item.webhookId) ?? []),
      item,
    ]);
  for (const [webhookId, items] of byWebhook) {
    const webhook = webhooks.get(webhookId);
    if (!webhook) continue;
    // A failed summary goes again right away; tests don't count.
    const retrying = items.some(({ event }) => event.status === "failed");
    if (
      !options.force &&
      !retrying &&
      (await GscTrackerAlertRepository.summarySentOn(webhook.id, today))
    )
      continue;
    // One summary per check; a very long one goes in a few parts.
    const batches = chunk(items, PER_POST);
    for (const batch of batches) {
      const result = await postAlerts(
        webhook,
        site,
        batch.map(({ event, type }) => ({
          type: type as GscTrackerAlertType,
          title: event.title,
          message: event.message,
          date: event.date,
          subject: event.subject,
          data: JSON.parse(event.data) as Record<string, unknown>,
        })),
      );
      await GscTrackerAlertRepository.markDelivery(
        batch.map(({ event }) => event.id),
        result,
      );
    }
  }
}
