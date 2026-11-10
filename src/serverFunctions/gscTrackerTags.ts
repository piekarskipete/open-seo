import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { GscTrackerTagService } from "@/server/features/gsc-tracker/services/GscTrackerTagService";
import { AppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  GSC_TRACKER_TAG_COLORS,
  GSC_TRACKER_TAG_NAME_MAX,
} from "@/shared/gsc-tracker";

const projectSchema = z.object({ projectId: z.string().min(1) });
const nameSchema = z.string().max(GSC_TRACKER_TAG_NAME_MAX * 2);
const createSchema = projectSchema.extend({
  name: nameSchema,
  color: z.enum(GSC_TRACKER_TAG_COLORS),
});
const updateSchema = projectSchema.extend({
  id: z.string().min(1),
  name: nameSchema.optional(),
  color: z.enum(GSC_TRACKER_TAG_COLORS).optional(),
});
const removeSchema = projectSchema.extend({ id: z.string().min(1) });
const assignSchema = projectSchema.extend({
  tagId: z.string().min(1),
  keywordIds: z.array(z.string().min(1)).min(1).max(1000),
  action: z.enum(["add", "remove"]),
});

/** A name the form should show next to the field rather than a toast code:
 *  thrown errors reach the client stripped to their code. */
async function withFormMessage<T>(run: () => Promise<T>) {
  try {
    return { ok: true as const, ...(await run()) };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "VALIDATION_ERROR" || error.code === "CONFLICT")
    )
      return { ok: false as const, message: error.message };
    throw error;
  }
}

export const listGscTrackerTags = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectSchema)
  .handler(({ context }) => GscTrackerTagService.list(context.projectId));

export const createGscTrackerTag = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(createSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return withFormMessage(() =>
      GscTrackerTagService.create({
        projectId: context.projectId,
        name: data.name,
        color: data.color,
      }),
    );
  });

export const updateGscTrackerTag = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return withFormMessage(async () => {
      await GscTrackerTagService.update({
        projectId: context.projectId,
        id: data.id,
        name: data.name,
        color: data.color,
      });
      return {};
    });
  });

export const deleteGscTrackerTag = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(removeSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await GscTrackerTagService.remove(context.projectId, data.id);
    return { removed: true as const };
  });

export const tagGscTrackerKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(assignSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return GscTrackerTagService.setOnKeywords({
      projectId: context.projectId,
      tagId: data.tagId,
      keywordIds: data.keywordIds,
      action: data.action,
    });
  });
