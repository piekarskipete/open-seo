import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerGroupService } from "@/server/features/gsc-tracker/services/GscTrackerGroupService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_CHART_DAYS,
  GSC_TRACKER_GROUP_KINDS,
  GSC_TRACKER_GROUP_NAME_MAX,
  GSC_TRACKER_RANGE_DAYS,
  GSC_TRACKER_URL_FILTER_MODES,
} from "@/shared/gsc-tracker";

// Page groups of a tracked site. Every call names the site; handlers check it
// belongs to the project, and the group to the site.
const siteSchema = z.object({
  projectId: z.string().min(1),
  siteId: z.string().min(1),
});
const daysSchema = z.union(
  GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days)),
);
const groupSchema = siteSchema.extend({ groupId: z.string().min(1) });
const urlsSchema = z.array(z.string().trim().min(1).max(2048)).min(1).max(5000);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nameSchema = z.string().max(GSC_TRACKER_GROUP_NAME_MAX * 2);
const patternSchema = z.string().max(4096);

const listGroupsSchema = siteSchema.extend({ days: daysSchema });
const getGroupSchema = groupSchema.extend({ days: daysSchema });
const pagesSchema = siteSchema.extend({
  days: daysSchema,
  groupId: z.string().min(1).optional(),
  urlMode: z.enum(GSC_TRACKER_URL_FILTER_MODES).optional(),
  url: z.string().max(100_000).optional(),
  queries: z.string().max(4096).optional(),
});
const createSchema = siteSchema.extend({
  name: nameSchema,
  kind: z.enum(GSC_TRACKER_GROUP_KINDS),
  pattern: patternSchema.optional(),
  urls: urlsSchema.optional(),
});
const updateSchema = groupSchema.extend({
  name: nameSchema.optional(),
  pattern: patternSchema.optional(),
});
const membersSchema = groupSchema.extend({ urls: urlsSchema });
const pageDetailSchema = siteSchema
  .extend({
    url: z.string().min(1).max(2048),
    days: z
      .union(GSC_TRACKER_CHART_DAYS.map((days) => z.literal(days)))
      .optional(),
    from: daySchema.optional(),
    to: daySchema.optional(),
  })
  .refine((data) => data.days !== undefined || (data.from && data.to), {
    message: "Pick a period or a date range.",
  });

export const listGscTrackerGroups = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listGroupsSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.listGroups(site, data.days);
  });

export const getGscTrackerGroup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getGroupSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.getGroup(site, data.groupId, data.days);
  });

export const listGscTrackerPages = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pagesSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.getPages({
      site,
      days: data.days,
      groupId: data.groupId,
      filter: { urlMode: data.urlMode, url: data.url, queries: data.queries },
    });
  });

export const getGscTrackerPageDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageDetailSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.getPageDetail({
      site,
      url: data.url,
      days: data.days,
      from: data.from,
      to: data.to,
    });
  });

export const createGscTrackerGroup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.createGroup({
      site,
      name: data.name,
      kind: data.kind,
      pattern: data.pattern,
      urls: data.urls,
    });
  });

export const updateGscTrackerGroup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerGroupService.updateGroup({
      site,
      groupId: data.groupId,
      name: data.name,
      pattern: data.pattern,
    });
    return { updated: true as const };
  });

export const deleteGscTrackerGroup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(groupSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerGroupService.deleteGroup(site, data.groupId);
    return { deleted: true as const };
  });

export const refreshGscTrackerGroup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(groupSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerGroupService.refreshNow(site, data.groupId);
    return { refreshed: true as const };
  });

export const addGscTrackerGroupUrls = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(membersSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.addUrls(site, data.groupId, data.urls);
  });

export const removeGscTrackerGroupUrls = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(membersSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerGroupService.removeUrls(site, data.groupId, data.urls);
  });
