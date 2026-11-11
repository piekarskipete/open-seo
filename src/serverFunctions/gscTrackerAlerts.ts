import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerAlertService } from "@/server/features/gsc-tracker/services/GscTrackerAlertService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_ALERT_TYPES,
  GSC_TRACKER_WEBHOOK_FORMATS,
  GSC_TRACKER_WEBHOOK_MODES,
} from "@/shared/gsc-tracker-alerts";

// A tracked site's alerts: webhooks, rules and what was sent. Every call
// names the site; handlers check it belongs to the project. Changes need the
// integration permission, as the tracker's other settings do.
const siteSchema = z.object({
  projectId: z.string().min(1),
  siteId: z.string().min(1),
});
const idSchema = siteSchema.extend({ id: z.string().min(1).max(100) });
const webhookSchema = siteSchema.extend({
  id: z.string().min(1).max(100).optional(),
  name: z.string().max(80),
  url: z.string().min(1).max(2048),
  secret: z.string().max(200).optional(),
  format: z.enum(GSC_TRACKER_WEBHOOK_FORMATS),
  mode: z.enum(GSC_TRACKER_WEBHOOK_MODES),
});
const ruleSchema = siteSchema.extend({
  id: z.string().min(1).max(100).optional(),
  type: z.enum(GSC_TRACKER_ALERT_TYPES),
  webhookId: z.string().min(1).max(100),
  params: z.object({
    places: z.number().optional(),
    top: z.number().optional(),
    percent: z.number().optional(),
    share: z.number().optional(),
    days: z.number().optional(),
    minImpressions: z.number().optional(),
    minClicks: z.number().optional(),
    tagId: z.string().max(100).optional(),
    groupId: z.string().max(100).optional(),
  }),
  active: z.boolean(),
  cooldownDays: z.number().int().min(0).max(90),
});
const recommendedSchema = siteSchema.extend({
  webhookId: z.string().min(1).max(100),
});

async function site(context: { projectId: string }, siteId: string) {
  return GscTrackerService.requireSite(context.projectId, siteId);
}

export const getGscTrackerAlerts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) =>
    GscTrackerAlertService.getAlerts(await site(context, data.siteId)),
  );

export const saveGscTrackerWebhook = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(webhookSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerAlertService.saveWebhook(
      await site(context, data.siteId),
      {
        id: data.id,
        name: data.name,
        url: data.url,
        secret: data.secret,
        format: data.format,
        mode: data.mode,
      },
    );
  });

export const deleteGscTrackerWebhook = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(idSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerAlertService.removeWebhook(
      await site(context, data.siteId),
      data.id,
    );
    return { deleted: true as const };
  });

export const testGscTrackerWebhook = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(idSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerAlertService.testWebhook(
      await site(context, data.siteId),
      data.id,
    );
  });

export const saveGscTrackerAlertRule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(ruleSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerAlertService.saveRule(await site(context, data.siteId), {
      id: data.id,
      type: data.type,
      webhookId: data.webhookId,
      params: data.params,
      active: data.active,
      cooldownDays: data.cooldownDays,
    });
  });

export const deleteGscTrackerAlertRule = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(idSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerAlertService.removeRule(
      await site(context, data.siteId),
      data.id,
    );
    return { deleted: true as const };
  });

export const addGscTrackerRecommendedAlerts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendedSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerAlertService.addRecommended(
      await site(context, data.siteId),
      data.webhookId,
    );
  });

/** Checks every rule against the newest data now and sends what it finds. */
export const runGscTrackerAlerts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const tracked = await site(context, data.siteId);
    const raised = await GscTrackerAlertService.runSiteAlerts(tracked.id, {
      force: true,
    });
    return { raised };
  });
