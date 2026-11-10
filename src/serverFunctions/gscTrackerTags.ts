import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { GscTrackerTagService } from "@/server/features/gsc-tracker/services/GscTrackerTagService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { GSC_TRACKER_TAG_NAME_MAX } from "@/shared/gsc-tracker";
import { TAG_COLOR_KEYS } from "@/shared/tag-colors";

const projectSchema = z.object({
  projectId: z.string().min(1),
  siteId: z.string().min(1),
});
const nameSchema = z.string().max(GSC_TRACKER_TAG_NAME_MAX * 2);
const updateSchema = projectSchema.extend({
  tagId: z.string().min(1),
  name: nameSchema.optional(),
  color: z.enum(TAG_COLOR_KEYS).optional(),
});
const removeSchema = projectSchema.extend({ tagId: z.string().min(1) });
const applySchema = projectSchema.extend({
  keywordIds: z.array(z.string().min(1)).min(1).max(1000),
  addTags: z.array(nameSchema).max(50).optional(),
  removeTagIds: z.array(z.string().min(1)).max(50).optional(),
});

export const listGscTrackerTags = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerTagService.list(site.id);
  });

export const updateGscTrackerTag = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerTagService.update({
      siteId: site.id,
      id: data.tagId,
      name: data.name,
      color: data.color,
    });
    return { updated: true as const };
  });

export const deleteGscTrackerTag = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(removeSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerTagService.remove(site.id, data.tagId);
    return { removed: true as const };
  });

/** Adds tags (by name) to and removes tags from the selected phrases. */
export const applyGscTrackerKeywordTags = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(applySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerTagService.applyToKeywords({
      siteId: site.id,
      keywordIds: data.keywordIds,
      addTags: data.addTags,
      removeTagIds: data.removeTagIds,
    });
  });
