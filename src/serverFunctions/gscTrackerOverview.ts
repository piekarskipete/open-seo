import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { getCheckpointSummary } from "@/server/features/gsc-tracker/services/gscTrackerCheckpoints";
import { requireProjectContext } from "@/serverFunctions/middleware";

const siteSchema = z.object({
  projectId: z.string().min(1),
  siteId: z.string().min(1),
});

/** Followed phrases grouped by their checkpoints, for the Overview. */
export const getGscTrackerCheckpoints = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(siteSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return getCheckpointSummary(site.id);
  });
