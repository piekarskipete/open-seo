import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerKeywordService } from "@/server/features/gsc-tracker/services/GscTrackerKeywordService";
import { getKeywordChart } from "@/server/features/gsc-tracker/services/gscTrackerKeywordChart";
import { trackQueries } from "@/server/features/gsc-tracker/services/gscTrackerTrackQueries";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_POSITION_FORMATS,
  GSC_TRACKER_RANGE_DAYS,
  GSC_TRACKER_SORT_KEYS,
  GSC_TRACKER_DATE_FORMATS,
  GSC_TRACKER_CHART_DAYS,
} from "@/shared/gsc-tracker";

// Every call but the site list and adding a site names one tracked site of
// the project; handlers check it belongs to the project before using it.
const projectSchema = z.object({ projectId: z.string().min(1) });
const siteSchema = projectSchema.extend({ siteId: z.string().min(1) });
const addSiteSchema = projectSchema.extend({
  // Both, or neither for the project's own Search Console connection.
  siteUrl: z.string().min(1).max(2048).optional(),
  accountId: z.string().min(1).max(500).optional(),
});
const rangeSchema = siteSchema.extend({
  days: z.union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days))),
});
const listSchema = rangeSchema.extend({
  search: z.string().max(200).optional(),
  page: z.string().max(2048).optional(),
});
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const chartDaysSchema = z
  .union(GSC_TRACKER_CHART_DAYS.map((days) => z.literal(days)))
  .optional();
// A query's detail: the last N days, or a custom range (both ends inclusive).
const querySchema = siteSchema
  .extend({
    query: z.string().min(1).max(500),
    days: chartDaysSchema,
    from: daySchema.optional(),
    to: daySchema.optional(),
  })
  .refine((data) => data.days !== undefined || (data.from && data.to), {
    message: "Pick a period or a date range.",
  });
const monthSchema = siteSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});
const addKeywordsSchema = siteSchema.extend({
  entries: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(500),
        targetUrl: z.string().trim().url().max(2048),
      }),
    )
    .min(1)
    .max(1000),
});
const keywordSchema = siteSchema.extend({ id: z.string().min(1) });
const idsSchema = z.array(z.string().min(1)).min(1).max(1000);
const startDateSchema = siteSchema.extend({
  ids: idsSchema,
  // A day, or null to measure from the day the phrase was added.
  startDate: daySchema.nullable(),
});
const checkpointsSchema = siteSchema.extend({
  ids: idsSchema,
  checkpoints: z.array(daySchema).max(2),
});
const keywordChartSchema = keywordSchema
  .extend({
    days: chartDaysSchema,
    // A custom range instead of `days`, both ends inclusive.
    from: daySchema.optional(),
    to: daySchema.optional(),
  })
  .refine((data) => data.days !== undefined || (data.from && data.to), {
    message: "Pick a period or a date range.",
  });
const trackQueriesSchema = rangeSchema.extend({
  queries: z.array(z.string().trim().min(1).max(500)).min(1).max(1000),
  page: z.string().max(2048).optional(),
  tags: z.array(z.string().max(80)).max(50).optional(),
  startDate: daySchema.nullable().optional(),
  checkpoints: z.array(daySchema).max(2).optional(),
});
const settingsSchema = siteSchema.extend({
  positionFormat: z.enum(GSC_TRACKER_POSITION_FORMATS).optional(),
  explorerSort: z.enum(GSC_TRACKER_SORT_KEYS).optional(),
  dateFormat: z.enum(GSC_TRACKER_DATE_FORMATS).optional(),
});

type Role = Parameters<typeof hasOrgPermission>[0];
const canManage = (role: Role) =>
  hasOrgPermission(role, { integration: ["manage"] });

/** The project's tracked sites, for the site list. */
export const getGscTrackerSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => ({
    ...(await GscTrackerService.getAvailability(context.projectId)),
    sites: await GscTrackerService.listSites(context.projectId),
    canManage: canManage(context.role),
  }));

/** One site's state, for its page. */
export const getGscTrackerStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return {
      ...(await GscTrackerService.getAvailability(context.projectId)),
      ...(await GscTrackerService.getStatus(site)),
      canManage: canManage(context.role),
    };
  });

export const addGscTrackerSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addSiteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerService.addSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      siteUrl: data.siteUrl,
      accountId: data.accountId,
    });
  });

export const syncGscTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerService.syncNow(site);
    return { synced: true as const };
  });

export const stopGscTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerService.removeSite(site);
    return { removed: true as const };
  });

export const getGscTrackerOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rangeSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerService.getOverview(site.id, data.days);
  });

export const getGscTrackerList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerService.compareQueries({
      siteId: site.id,
      days: data.days,
      search: data.search,
      page: data.page,
    });
  });

export const getGscTrackerQuery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(querySchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerService.getQueryDetail({
      siteId: site.id,
      query: data.query,
      days: data.days,
      from: data.from,
      to: data.to,
    });
  });

export const getGscTrackerCannibalization = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rangeSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerService.getCannibalization(site.id, data.days);
  });

export const getGscTrackerKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(monthSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerKeywordService.getMonth(site.id, data.month);
  });

export const addGscTrackerKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addKeywordsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerKeywordService.add(site.id, data.entries);
  });

export const removeGscTrackerKeyword = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerKeywordService.remove(site.id, data.id);
    return { removed: true as const };
  });

export const updateGscTrackerSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(settingsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerService.updateSettings(site, {
      positionFormat: data.positionFormat,
      explorerSort: data.explorerSort,
      dateFormat: data.dateFormat,
    });
    return { updated: true as const };
  });

export const listGscTrackerTargets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerKeywordService.listTargets(site.id);
  });

export const setGscTrackerKeywordStart = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startDateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerKeywordService.setStartDate({
      siteId: site.id,
      ids: data.ids,
      startDate: data.startDate,
    });
    return { startDate: data.startDate, updated: data.ids.length };
  });

export const setGscTrackerKeywordCheckpoints = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(checkpointsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerKeywordService.setCheckpoints({
      siteId: site.id,
      ids: data.ids,
      checkpoints: data.checkpoints,
    });
    return { updated: data.ids.length };
  });

export const getGscTrackerKeywordChart = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordChartSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return getKeywordChart({
      siteId: site.id,
      id: data.id,
      days: data.days,
      from: data.from,
      to: data.to,
    });
  });

/** Follows Query Explorer queries, each with its top page, and tags them. */
export const trackGscTrackerQueries = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(trackQueriesSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return trackQueries({
      siteId: site.id,
      queries: data.queries,
      days: data.days,
      page: data.page,
      tags: data.tags,
      startDate: data.startDate,
      checkpoints: data.checkpoints,
    });
  });
