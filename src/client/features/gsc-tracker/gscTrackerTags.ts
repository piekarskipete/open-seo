// Tag data for the GSC Tracker's phrases, kept apart from the components so
// the component modules only export components.

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { listGscTrackerTags } from "@/serverFunctions/gscTrackerTags";

export type Tag = Awaited<ReturnType<typeof listGscTrackerTags>>[number];

/** Whether a phrase carries any of the chosen tags; no choice keeps all. */
export function matchesTagFilter(
  tagIds: string[],
  filter: readonly string[],
): boolean {
  if (filter.length === 0) return true;
  return tagIds.some((id) => filter.includes(id));
}

export function useTags(projectId: string, siteId: string) {
  return useQuery({
    queryKey: ["gscTrackerTags", siteId],
    queryFn: () => listGscTrackerTags({ data: { projectId, siteId } }),
  });
}

/** Refetches the tags and the phrases that show them. */
export function refreshTags(queryClient: QueryClient, projectId: string) {
  void queryClient.invalidateQueries({
    queryKey: ["gscTrackerTags", projectId],
  });
  void queryClient.invalidateQueries({
    queryKey: ["gscTrackerKeywords", projectId],
  });
}
