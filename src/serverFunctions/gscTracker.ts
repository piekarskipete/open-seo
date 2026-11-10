import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerKeywordService } from "@/server/features/gsc-tracker/services/GscTrackerKeywordService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_POSITION_FORMATS,
  GSC_TRACKER_RANGE_DAYS,
} from "@/shared/gsc-tracker";

const projectSchema = z.object({ projectId: z.string().min(1) });
const rangeSchema = projectSchema.extend({
  days: z.union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days))),
});
const listSchema = rangeSchema.extend({
  dimension: z.enum(["query", "page"]),
  search: z.string().max(200).optional(),
});
const querySchema = rangeSchema.extend({ query: z.string().min(1).max(500) });
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
const formatSchema = projectSchema.extend({
  positionFormat: z.enum(GSC_TRACKER_POSITION_FORMATS),
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
    GscTrackerService.compareBy({
      projectId: context.projectId,
      days: data.days,
      dimension: data.dimension,
      search: data.search,
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

export const setGscTrackerPositionFormat = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(formatSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerService.setPositionFormat(
      context.projectId,
      data.positionFormat,
    );
    return { positionFormat: data.positionFormat };
  });
