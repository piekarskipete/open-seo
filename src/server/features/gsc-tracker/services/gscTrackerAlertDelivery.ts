import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import {
  GscTrackerAlertRepository,
  type GscTrackerWebhook,
} from "../repositories/GscTrackerAlertRepository";
import { describeError } from "@/server/lib/errors";
import { GSC_TRACKER_ALERT_DEFINITIONS } from "@/shared/gsc-tracker-alerts";
import type { GscTrackerAlertType } from "@/shared/gsc-tracker-alerts";

// Sends alerts to a site's webhooks: one POST per alert ("instant") or one
// per check with all of them ("digest"), as plain JSON or as a Slack or
// Discord message, signed with the webhook's secret when it has one.

const TIMEOUT_MS = 10_000;
// Alerts per digest POST, and per batch of status updates (D1 binds ~100).
const PER_POST = 50;
const DISCORD_LIMIT = 1_900;

type OutgoingAlert = {
  type: GscTrackerAlertType | "test";
  title: string;
  message: string;
  date: string;
  subject: string;
  data: Record<string, unknown>;
};

function body(
  webhook: Pick<GscTrackerWebhook, "format">,
  site: Pick<GscTrackerSite, "id" | "siteUrl">,
  alerts: OutgoingAlert[],
): string {
  const lines = alerts.map((alert) => `• *${alert.title}* — ${alert.message}`);
  if (webhook.format === "slack")
    return JSON.stringify({
      text: [`*GSC Tracker · ${site.siteUrl}*`, ...lines].join("\n"),
    });
  if (webhook.format === "discord") {
    const text = [`**GSC Tracker · ${site.siteUrl}**`, ...lines]
      .join("\n")
      .replace(/\*([^*]+)\*/g, "**$1**");
    return JSON.stringify({
      content:
        text.length > DISCORD_LIMIT ? `${text.slice(0, DISCORD_LIMIT)}…` : text,
    });
  }
  return JSON.stringify({
    event: "gsc_tracker.alerts",
    sentAt: new Date().toISOString(),
    site: { id: site.id, url: site.siteUrl },
    alerts: alerts.map((alert) => ({
      ...alert,
      label:
        alert.type === "test"
          ? "Test"
          : GSC_TRACKER_ALERT_DEFINITIONS[alert.type].label,
    })),
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
export async function deliverPending(site: GscTrackerSite): Promise<void> {
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
    const batches =
      webhook.mode === "digest"
        ? chunk(items, PER_POST)
        : items.map((item) => [item]);
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
