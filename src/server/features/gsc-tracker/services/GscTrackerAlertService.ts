import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import {
  GscTrackerAlertRepository,
  type GscTrackerAlertRule,
} from "../repositories/GscTrackerAlertRepository";
import { GscTrackerGroupRepository } from "../repositories/GscTrackerGroupRepository";
import { PageAlerts } from "./gscTrackerAlertPages";
import { PhraseAlerts, type AlertCandidate } from "./gscTrackerAlertPhrases";
import { deliverPending, postAlerts } from "./gscTrackerAlertDelivery";
import { addDays } from "./gscTrackerDates";
import { GscTrackerTagService } from "./GscTrackerTagService";
import { AppError, describeError } from "@/server/lib/errors";
import {
  alertParams,
  GSC_TRACKER_ALERT_DEFINITIONS,
  GSC_TRACKER_ALERT_TYPES,
  GSC_TRACKER_RECOMMENDED_ALERTS,
  parseAlertParams,
  type GscTrackerAlertParams,
  type GscTrackerAlertType,
  type GscTrackerWebhookFormat,
  type GscTrackerWebhookMode,
} from "@/shared/gsc-tracker-alerts";

// GSC Tracker alerts: rules checked after each sync, alerts recorded once
// per rule, subject and day, then sent to the rule's webhook.

// Search Console keeps revising its newest days; rules look this many days
// back from the newest stored one, where the numbers have settled.
const SETTLE_DAYS = 2;
// Rules about the tracker's own state run on every sync, not once a day.
const EVERY_SYNC: GscTrackerAlertType[] = ["sync_error", "sitemap_new_urls"];
const HISTORY_LIMIT = 100;

const CHECKS: Record<
  GscTrackerAlertType,
  (
    site: GscTrackerSite,
    evalDate: string,
    params: GscTrackerAlertParams,
    now: Date,
  ) => Promise<AlertCandidate[]>
> = { ...PhraseAlerts, ...PageAlerts };

function ruleType(rule: GscTrackerAlertRule): GscTrackerAlertType | null {
  return GSC_TRACKER_ALERT_TYPES.find((type) => type === rule.type) ?? null;
}

/** Checks one rule and records the alerts it raises; returns how many. */
async function checkRule(
  site: GscTrackerSite,
  rule: GscTrackerAlertRule,
  evalDate: string,
  now: Date,
): Promise<number> {
  const type = ruleType(rule);
  if (!type) return 0;
  const candidates = await CHECKS[type](
    site,
    evalDate,
    alertParams(type, parseAlertParams(rule.params)),
    now,
  );
  let added = 0;
  for (const candidate of candidates) {
    if (
      rule.cooldownDays > 0 &&
      candidate.date.length === 10 &&
      (await GscTrackerAlertRepository.alertedSince(
        rule.id,
        candidate.subject,
        addDays(candidate.date, -rule.cooldownDays),
      ))
    )
      continue;
    if (
      await GscTrackerAlertRepository.addEvent({
        ruleId: rule.id,
        siteId: site.id,
        subject: candidate.subject,
        date: candidate.date,
        title: candidate.title,
        message: candidate.message,
        data: JSON.stringify({ ...candidate.data, line: candidate.line }),
      })
    )
      added += 1;
  }
  return added;
}

/**
 * Runs the site's active rules: the daily ones once per new settled day
 * (or now, with `force`), the sync ones every time; then sends what's
 * waiting. Returns how many alerts were raised.
 */
async function runSiteAlerts(
  siteId: string,
  options: { now?: Date; force?: boolean } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const site = await GscTrackerRepository.get(siteId);
  if (!site) return 0;
  const rules = (await GscTrackerAlertRepository.listRules(site.id)).filter(
    (rule) => rule.active === 1,
  );
  const evalDate = site.newestDate
    ? addDays(site.newestDate, -SETTLE_DAYS)
    : null;
  let added = 0;
  for (const rule of rules) {
    const type = ruleType(rule);
    if (!type) continue;
    const everySync = EVERY_SYNC.includes(type);
    if (!evalDate && !everySync) continue;
    const day = evalDate ?? now.toISOString().slice(0, 10);
    if (!everySync && !options.force && rule.lastEvaluatedDate === day)
      continue;
    try {
      added += await checkRule(site, rule, day, now);
      await GscTrackerAlertRepository.updateRule(rule.id, {
        lastEvaluatedDate: day,
      });
    } catch (error) {
      console.error("[gsc-tracker] alert rule failed", {
        ruleId: rule.id,
        error: describeError(error),
      });
    }
  }
  await deliverPending(site);
  return added;
}

// --- Webhooks ---------------------------------------------------------------

function cleanUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError("VALIDATION_ERROR", "Enter the webhook's full URL.");
  }
  if (!/^https?:$/.test(url.protocol))
    throw new AppError("VALIDATION_ERROR", "Use an http or https URL.");
  return url.toString();
}

async function saveWebhook(
  site: GscTrackerSite,
  input: {
    id?: string;
    name: string;
    url: string;
    /** Undefined keeps the current one; "" removes it. */
    secret?: string;
    format: GscTrackerWebhookFormat;
    mode: GscTrackerWebhookMode;
  },
) {
  const name = input.name.trim() || "Webhook";
  const url = cleanUrl(input.url);
  const secret =
    input.secret === undefined ? undefined : input.secret.trim() || null;
  if (input.id) {
    if (!(await GscTrackerAlertRepository.getWebhook(site.id, input.id)))
      throw new AppError("NOT_FOUND", "That webhook no longer exists.");
    await GscTrackerAlertRepository.updateWebhook(input.id, {
      name,
      url,
      format: input.format,
      mode: input.mode,
      ...(secret === undefined ? {} : { secret }),
    });
    return { id: input.id };
  }
  const id = crypto.randomUUID();
  await GscTrackerAlertRepository.createWebhook({
    id,
    projectId: site.projectId,
    siteId: site.id,
    name,
    url,
    secret: secret ?? null,
    format: input.format,
    mode: input.mode,
  });
  return { id };
}

async function requireWebhook(site: GscTrackerSite, id: string) {
  const webhook = await GscTrackerAlertRepository.getWebhook(site.id, id);
  if (!webhook)
    throw new AppError("NOT_FOUND", "That webhook no longer exists.");
  return webhook;
}

async function removeWebhook(site: GscTrackerSite, id: string) {
  await requireWebhook(site, id);
  await GscTrackerAlertRepository.removeWebhook(id);
}

/** Sends a sample alert, so the receiving end can be set up and checked. */
async function testWebhook(site: GscTrackerSite, id: string) {
  const webhook = await requireWebhook(site, id);
  const today = new Date().toISOString().slice(0, 10);
  return postAlerts(webhook, site, [
    {
      type: "test",
      title: "Test alert from GSC Tracker",
      message: `Alerts for ${site.siteUrl} will arrive here.`,
      date: today,
      subject: "test",
      data: { test: true },
    },
  ]);
}

// --- Rules ------------------------------------------------------------------

async function cleanScope(site: GscTrackerSite, params: GscTrackerAlertParams) {
  if (params.tagId) {
    const tags = await GscTrackerTagService.list(site.id);
    if (!tags.some((tag) => tag.id === params.tagId))
      throw new AppError("NOT_FOUND", "That tag no longer exists.");
  }
  if (params.groupId) {
    const group = await GscTrackerGroupRepository.getForSite(
      site.id,
      params.groupId,
    );
    if (!group) throw new AppError("NOT_FOUND", "That group no longer exists.");
  }
}

async function saveRule(
  site: GscTrackerSite,
  input: {
    id?: string;
    type: GscTrackerAlertType;
    webhookId: string;
    params: GscTrackerAlertParams;
    active: boolean;
    cooldownDays: number;
  },
) {
  await requireWebhook(site, input.webhookId);
  const definition = GSC_TRACKER_ALERT_DEFINITIONS[input.type];
  const params = alertParams(input.type, {
    ...input.params,
    tagId: definition.scope === "phrases" ? input.params.tagId : undefined,
    groupId: definition.scope === "groups" ? input.params.groupId : undefined,
  });
  await cleanScope(site, params);
  const values = {
    webhookId: input.webhookId,
    params: JSON.stringify(params),
    active: input.active ? 1 : 0,
    cooldownDays: Math.min(90, Math.max(0, Math.round(input.cooldownDays))),
  };
  if (input.id) {
    const rule = await GscTrackerAlertRepository.getRule(site.id, input.id);
    if (!rule) throw new AppError("NOT_FOUND", "That rule no longer exists.");
    // Changed thresholds look at the newest day again.
    await GscTrackerAlertRepository.updateRule(rule.id, {
      ...values,
      lastEvaluatedDate: null,
    });
    return { id: rule.id };
  }
  const id = crypto.randomUUID();
  await GscTrackerAlertRepository.createRules([
    {
      id,
      projectId: site.projectId,
      siteId: site.id,
      type: input.type,
      ...values,
    },
  ]);
  return { id };
}

async function removeRule(site: GscTrackerSite, id: string) {
  const rule = await GscTrackerAlertRepository.getRule(site.id, id);
  if (!rule) throw new AppError("NOT_FOUND", "That rule no longer exists.");
  await GscTrackerAlertRepository.removeRule(rule.id);
}

/** Adds the recommended rules the webhook doesn't have yet, with defaults. */
async function addRecommended(site: GscTrackerSite, webhookId: string) {
  await requireWebhook(site, webhookId);
  const existing = await GscTrackerAlertRepository.listRules(site.id);
  const rows = GSC_TRACKER_RECOMMENDED_ALERTS.filter(
    (type) =>
      !existing.some(
        (rule) => rule.type === type && rule.webhookId === webhookId,
      ),
  ).map((type) => ({
    id: crypto.randomUUID(),
    projectId: site.projectId,
    siteId: site.id,
    webhookId,
    type,
    params: JSON.stringify(alertParams(type, {})),
    active: 1,
    cooldownDays: GSC_TRACKER_ALERT_DEFINITIONS[type].cooldownDays,
  }));
  await GscTrackerAlertRepository.createRules(rows);
  return { added: rows.length };
}

/** The Alerts tab: webhooks (secrets hidden), rules and recent alerts. */
async function getAlerts(site: GscTrackerSite) {
  const [webhooks, rules, history] = await Promise.all([
    GscTrackerAlertRepository.listWebhooks(site.id),
    GscTrackerAlertRepository.listRules(site.id),
    GscTrackerAlertRepository.history(site.id, HISTORY_LIMIT),
  ]);
  return {
    webhooks: webhooks.map(({ secret, ...webhook }) => ({
      ...webhook,
      hasSecret: Boolean(secret),
    })),
    rules: rules.flatMap((rule) => {
      const type = ruleType(rule);
      return type
        ? [
            {
              id: rule.id,
              type,
              webhookId: rule.webhookId,
              params: alertParams(type, parseAlertParams(rule.params)),
              active: rule.active === 1,
              cooldownDays: rule.cooldownDays,
              lastEvaluatedDate: rule.lastEvaluatedDate,
            },
          ]
        : [];
    }),
    history,
  };
}

export const GscTrackerAlertService = {
  runSiteAlerts,
  saveWebhook,
  removeWebhook,
  testWebhook,
  saveRule,
  removeRule,
  addRecommended,
  getAlerts,
};
