import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerKeywordService } from "@/server/features/gsc-tracker/services/GscTrackerKeywordService";
import { getKeywordChart } from "@/server/features/gsc-tracker/services/gscTrackerKeywordChart";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_POSITION_FORMATS,
  GSC_TRACKER_RANGE_DAYS,
  GSC_TRACKER_SORT_KEYS,
  GSC_TRACKER_DATE_FORMATS,
  GSC_TRACKER_CHART_DAYS,
} from "@/shared/gsc-tracker";

const projectSchema = z.object({ projectId: z.string().min(1) });
const rangeSchema = projectSchema.extend({
  days: z.union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days))),
});
const listSchema = rangeSchema.extend({
  search: z.string().max(200).optional(),
  page: z.string().max(2048).optional(),
});
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// A query's detail: the last N days, or a custom range (both ends inclusive).
const querySchema = projectSchema
  .extend({
    query: z.string().min(1).max(500),
    days: z
      .union(GSC_TRACKER_CHART_DAYS.map((days) => z.literal(days)))
      .optional(),
    from: daySchema.optional(),
    to: daySchema.optional(),
  })
  .refine((data) => data.days !== undefined || (data.from && data.to), {
    message: "Pick a period or a date range.",
  });
const monthSchema = projectSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});
const addKeywordsSchema = projectSchema.extend({
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
const keywordSchema = projectSchema.extend({ id: z.string().min(1) });
const startDateSchema = projectSchema.extend({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  // A day, or null to measure from the day the phrase was added.
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
const checkpointsSchema = projectSchema.extend({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  checkpoints: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(2),
});
const keywordChartSchema = keywordSchema
  .extend({
    days: z
      .union(GSC_TRACKER_CHART_DAYS.map((days) => z.literal(days)))
      .optional(),
    // A custom range instead of `days`, both ends inclusive.
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((data) => data.days !== undefined || (data.from && data.to), {
    message: "Pick a period or a date range.",
  });
const settingsSchema = projectSchema.extend({
  positionFormat: z.enum(GSC_TRACKER_POSITION_FORMATS).optional(),
  explorerSort: z.enum(GSC_TRACKER_SORT_KEYS).optional(),
  dateFormat: z.enum(GSC_TRACKER_DATE_FORMATS).optional(),
});

export const getGscTrackerStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => ({
    ...(await GscTrackerService.getStatus(context.projectId)),
    canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
  }));

export const startGscTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerService.enable({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
    });
    return { enabled: true as const };
  });

export const syncGscTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerService.syncNow(context.projectId);
    return { synced: true as const };
  });

export const stopGscTracker = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerService.disable(context.projectId);
    return { enabled: false as const };
  });

export const getGscTrackerOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rangeSchema)
  .handler(({ data, context }) =>
    GscTrackerService.getOverview(context.projectId, data.days),
  );

export const getGscTrackerList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSchema)
  .handler(({ data, context }) =>
    GscTrackerService.compareQueries({
      projectId: context.projectId,
      days: data.days,
      search: data.search,
      page: data.page,
    }),
  );

export const getGscTrackerQuery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(querySchema)
  .handler(({ data, context }) =>
    GscTrackerService.getQueryDetail({
      projectId: context.projectId,
      query: data.query,
      days: data.days,
      from: data.from,
      to: data.to,
    }),
  );

export const getGscTrackerCannibalization = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rangeSchema)
  .handler(({ data, context }) =>
    GscTrackerService.getCannibalization(context.projectId, data.days),
  );

export const getGscTrackerKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(monthSchema)
  .handler(({ data, context }) =>
    GscTrackerKeywordService.getMonth(context.projectId, data.month),
  );

export const addGscTrackerKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addKeywordsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerKeywordService.add(context.projectId, data.entries);
  });

export const removeGscTrackerKeyword = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerKeywordService.remove(context.projectId, data.id);
    return { removed: true as const };
  });

export const updateGscTrackerSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(settingsSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerService.updateSettings(context.projectId, {
      positionFormat: data.positionFormat,
      explorerSort: data.explorerSort,
      dateFormat: data.dateFormat,
    });
    return { updated: true as const };
  });

export const listGscTrackerTargets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(({ context }) =>
    GscTrackerKeywordService.listTargets(context.projectId),
  );

export const setGscTrackerKeywordStart = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(startDateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerKeywordService.setStartDate({
      projectId: context.projectId,
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
    await GscTrackerKeywordService.setCheckpoints({
      projectId: context.projectId,
      ids: data.ids,
      checkpoints: data.checkpoints,
    });
    return { updated: data.ids.length };
  });

export const getGscTrackerKeywordChart = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(keywordChartSchema)
  .handler(({ data, context }) =>
    getKeywordChart({
      projectId: context.projectId,
      id: data.id,
      days: data.days,
      from: data.from,
      to: data.to,
    }),
  );
