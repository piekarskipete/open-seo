import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { GSC_TRACKER_RANGE_DAYS } from "@/shared/gsc-tracker";

const projectSchema = z.object({ projectId: z.string().min(1) });
const rangeSchema = projectSchema.extend({
  days: z.union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days))),
});
const listSchema = rangeSchema.extend({
  dimension: z.enum(["query", "page"]),
  search: z.string().max(200).optional(),
});
const querySchema = rangeSchema.extend({ query: z.string().min(1).max(500) });

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
