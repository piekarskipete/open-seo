import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  gscTrackerAlertEvents,
  gscTrackerAlertRules,
  gscTrackerWebhooks,
} from "@/db/schema";

export type GscTrackerWebhook = typeof gscTrackerWebhooks.$inferSelect;
export type GscTrackerAlertRule = typeof gscTrackerAlertRules.$inferSelect;

// Deliveries a failing alert gets before it stays failed.
const MAX_DELIVERY_ATTEMPTS = 5;

async function listWebhooks(siteId: string): Promise<GscTrackerWebhook[]> {
  return db
    .select()
    .from(gscTrackerWebhooks)
    .where(eq(gscTrackerWebhooks.siteId, siteId))
    .orderBy(gscTrackerWebhooks.createdAt);
}

async function getWebhook(siteId: string, id: string) {
  const [row] = await db
    .select()
    .from(gscTrackerWebhooks)
    .where(
      and(eq(gscTrackerWebhooks.siteId, siteId), eq(gscTrackerWebhooks.id, id)),
    )
    .limit(1);
  return row ?? null;
}

async function createWebhook(values: typeof gscTrackerWebhooks.$inferInsert) {
  await db.insert(gscTrackerWebhooks).values(values);
}

async function updateWebhook(
  id: string,
  values: Partial<
    Pick<
      GscTrackerWebhook,
      | "name"
      | "url"
      | "secret"
      | "format"
      | "mode"
      | "lastStatus"
      | "lastError"
      | "lastSentAt"
    >
  >,
) {
  await db
    .update(gscTrackerWebhooks)
    .set(values)
    .where(eq(gscTrackerWebhooks.id, id));
}

async function removeWebhook(id: string) {
  const rules = db
    .select({ id: gscTrackerAlertRules.id })
    .from(gscTrackerAlertRules)
    .where(eq(gscTrackerAlertRules.webhookId, id));
  await runBatch((tx) => [
    tx
      .delete(gscTrackerAlertEvents)
      .where(inArray(gscTrackerAlertEvents.ruleId, rules)),
    tx
      .delete(gscTrackerAlertRules)
      .where(eq(gscTrackerAlertRules.webhookId, id)),
    tx.delete(gscTrackerWebhooks).where(eq(gscTrackerWebhooks.id, id)),
  ]);
}

async function listRules(siteId: string): Promise<GscTrackerAlertRule[]> {
  return db
    .select()
    .from(gscTrackerAlertRules)
    .where(eq(gscTrackerAlertRules.siteId, siteId))
    .orderBy(gscTrackerAlertRules.createdAt);
}

async function getRule(siteId: string, id: string) {
  const [row] = await db
    .select()
    .from(gscTrackerAlertRules)
    .where(
      and(
        eq(gscTrackerAlertRules.siteId, siteId),
        eq(gscTrackerAlertRules.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function createRules(rows: (typeof gscTrackerAlertRules.$inferInsert)[]) {
  if (rows.length > 0) await db.insert(gscTrackerAlertRules).values(rows);
}

async function updateRule(
  id: string,
  values: Partial<
    Pick<
      GscTrackerAlertRule,
      "webhookId" | "params" | "active" | "cooldownDays" | "lastEvaluatedDate"
    >
  >,
) {
  await db
    .update(gscTrackerAlertRules)
    .set(values)
    .where(eq(gscTrackerAlertRules.id, id));
}

async function removeRule(id: string) {
  await runBatch((tx) => [
    tx
      .delete(gscTrackerAlertEvents)
      .where(eq(gscTrackerAlertEvents.ruleId, id)),
    tx.delete(gscTrackerAlertRules).where(eq(gscTrackerAlertRules.id, id)),
  ]);
}

/** Whether the rule alerted about the subject after `since` (a day). */
async function alertedSince(ruleId: string, subject: string, since: string) {
  const [row] = await db
    .select({ id: gscTrackerAlertEvents.id })
    .from(gscTrackerAlertEvents)
    .where(
      and(
        eq(gscTrackerAlertEvents.ruleId, ruleId),
        eq(gscTrackerAlertEvents.subject, subject),
        gt(gscTrackerAlertEvents.date, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Records an alert unless the same rule, subject and day already has one. */
async function addEvent(values: typeof gscTrackerAlertEvents.$inferInsert) {
  const rows = await db
    .insert(gscTrackerAlertEvents)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: gscTrackerAlertEvents.id });
  return rows.length > 0;
}

/** Alerts still to deliver, with their rule's webhook. */
async function undelivered(siteId: string) {
  return db
    .select({
      event: gscTrackerAlertEvents,
      type: gscTrackerAlertRules.type,
      webhookId: gscTrackerAlertRules.webhookId,
    })
    .from(gscTrackerAlertEvents)
    .innerJoin(
      gscTrackerAlertRules,
      eq(gscTrackerAlertRules.id, gscTrackerAlertEvents.ruleId),
    )
    .where(
      and(
        eq(gscTrackerAlertEvents.siteId, siteId),
        inArray(gscTrackerAlertEvents.status, ["pending", "failed"]),
        lt(gscTrackerAlertEvents.attempts, MAX_DELIVERY_ATTEMPTS),
      ),
    )
    .orderBy(gscTrackerAlertEvents.id);
}

async function markDelivery(
  ids: number[],
  result: { ok: boolean; status: number | null },
) {
  if (ids.length === 0) return;
  await db
    .update(gscTrackerAlertEvents)
    .set({
      status: result.ok ? "sent" : "failed",
      responseStatus: result.status,
      attempts: sql`${gscTrackerAlertEvents.attempts} + 1`,
      ...(result.ok ? { sentAt: new Date().toISOString() } : {}),
    })
    .where(inArray(gscTrackerAlertEvents.id, ids));
}

/** Whether the webhook got a summary with alerts on the given day. */
async function summarySentOn(webhookId: string, day: string) {
  const [row] = await db
    .select({ id: gscTrackerAlertEvents.id })
    .from(gscTrackerAlertEvents)
    .innerJoin(
      gscTrackerAlertRules,
      eq(gscTrackerAlertRules.id, gscTrackerAlertEvents.ruleId),
    )
    .where(
      and(
        eq(gscTrackerAlertRules.webhookId, webhookId),
        eq(gscTrackerAlertEvents.status, "sent"),
        sql`substr(${gscTrackerAlertEvents.sentAt}, 1, 10) = ${day}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The site's latest alerts, newest first. */
async function history(siteId: string, limit: number) {
  return db
    .select({
      id: gscTrackerAlertEvents.id,
      ruleId: gscTrackerAlertEvents.ruleId,
      type: gscTrackerAlertRules.type,
      date: gscTrackerAlertEvents.date,
      title: gscTrackerAlertEvents.title,
      message: gscTrackerAlertEvents.message,
      status: gscTrackerAlertEvents.status,
      attempts: gscTrackerAlertEvents.attempts,
      responseStatus: gscTrackerAlertEvents.responseStatus,
      sentAt: gscTrackerAlertEvents.sentAt,
      createdAt: gscTrackerAlertEvents.createdAt,
    })
    .from(gscTrackerAlertEvents)
    .innerJoin(
      gscTrackerAlertRules,
      eq(gscTrackerAlertRules.id, gscTrackerAlertEvents.ruleId),
    )
    .where(eq(gscTrackerAlertEvents.siteId, siteId))
    .orderBy(desc(gscTrackerAlertEvents.id))
    .limit(limit);
}

/** Deletes every webhook, rule and alert of a site. */
async function clearSite(siteId: string) {
  await runBatch((tx) => [
    tx
      .delete(gscTrackerAlertEvents)
      .where(eq(gscTrackerAlertEvents.siteId, siteId)),
    tx
      .delete(gscTrackerAlertRules)
      .where(eq(gscTrackerAlertRules.siteId, siteId)),
    tx.delete(gscTrackerWebhooks).where(eq(gscTrackerWebhooks.siteId, siteId)),
  ]);
}

export const GscTrackerAlertRepository = {
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  removeWebhook,
  listRules,
  getRule,
  createRules,
  updateRule,
  removeRule,
  alertedSince,
  addEvent,
  undelivered,
  markDelivery,
  summarySentOn,
  history,
  clearSite,
};
