import {
  buildSearchAnalyticsRequest,
  type GscPerformanceInput,
} from "@/server/features/gsc/searchAnalytics";
import { GscService } from "@/server/features/gsc/services/GscService";
import { createGscClient } from "@/server/lib/gscClient";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import type { GscTrackerSite } from "../repositories/GscTrackerRepository";

/** How the tracker reaches a site's property: the account the site was
 *  added with, or the project's Search Console connection. */
async function siteCredentials(site: GscTrackerSite) {
  if (site.connectedByUserId)
    return {
      userId: site.connectedByUserId,
      gscAccountId: site.gscAccountId ?? undefined,
      serviceAccountId: site.serviceAccountId ?? undefined,
    };
  const connection = await GscService.getConnection(site.projectId);
  if (!connection) return null;
  return {
    userId: connection.connectedByUserId,
    gscAccountId: connection.gscAccountId ?? undefined,
    serviceAccountId: connection.serviceAccountId ?? undefined,
  };
}

/** Search Console's `searchAnalytics.query` for one tracked site. */
export async function querySite(
  site: GscTrackerSite,
  input: Omit<GscPerformanceInput, "projectId">,
) {
  const credentials = await siteCredentials(site);
  if (!credentials) throw new GscNotConnectedError(site.projectId);
  const request = buildSearchAnalyticsRequest({
    ...input,
    projectId: site.projectId,
  });
  // The tracker asks for Google's full page, past the tool cap.
  if (input.rowLimit !== undefined)
    request.rowLimit = Math.max(1, Math.min(25000, input.rowLimit));
  const client = createGscClient(credentials);
  return { rows: await client.querySearchAnalytics(site.siteUrl, request) };
}
