import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GscTrackerService } from "@/server/features/gsc-tracker/services/GscTrackerService";
import { getCheckpointSummary } from "@/server/features/gsc-tracker/services/gscTrackerCheckpoints";
import { GscTrackerRankLink } from "@/server/features/gsc-tracker/services/gscTrackerRankLink";
import { requireOrgPermission } from "@/server/auth/org-gate";
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

const monthSchema = siteSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});
const linkSchema = siteSchema.extend({
  configId: z.string().min(1).max(100).nullable(),
  device: z.enum(["desktop", "mobile"]).optional(),
});

/** The last day of a YYYY-MM month. */
function monthEnd(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, index ?? 1, 0))
    .toISOString()
    .slice(0, 10);
}

/** The site's Rank Tracking link, and each followed phrase's positions there
 *  for the month, to set beside Search Console's. */
export const getGscTrackerRankComparison = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(monthSchema)
  .handler(async ({ data, context }) => {
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    return GscTrackerRankLink.getRankComparison({
      site,
      from: `${data.month}-01`,
      to: monthEnd(data.month),
    });
  });

/** Links the site to a Rank Tracking domain of the project, or unlinks it. */
export const saveGscTrackerRankLink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(linkSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const site = await GscTrackerService.requireSite(
      context.projectId,
      data.siteId,
    );
    await GscTrackerRankLink.saveLink(site, {
      configId: data.configId,
      device: data.device,
    });
    return { saved: true as const };
  });
