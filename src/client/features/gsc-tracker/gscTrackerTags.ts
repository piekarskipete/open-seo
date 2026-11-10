// Tag colors and data for the GSC Tracker, kept apart from the components so
// the component modules only export components.

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { listGscTrackerTags } from "@/serverFunctions/gscTrackerTags";
import {
  GSC_TRACKER_TAG_COLORS,
  type GscTrackerTagColor,
} from "@/shared/gsc-tracker";

export type Tag = Awaited<ReturnType<typeof listGscTrackerTags>>[number];

/** Chip and swatch classes per color, readable in light and dark themes. */
export const TAG_COLORS: Record<
  GscTrackerTagColor,
  { label: string; chip: string; swatch: string }
> = {
  gray: {
    label: "Gray",
    chip: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
    swatch: "bg-zinc-500",
  },
  red: {
    label: "Red",
    chip: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    swatch: "bg-red-500",
  },
  orange: {
    label: "Orange",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    swatch: "bg-orange-500",
  },
  amber: {
    label: "Amber",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    swatch: "bg-amber-400",
  },
  green: {
    label: "Green",
    chip: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    swatch: "bg-green-500",
  },
  teal: {
    label: "Teal",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
    swatch: "bg-teal-500",
  },
  blue: {
    label: "Blue",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    swatch: "bg-blue-500",
  },
  violet: {
    label: "Violet",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    swatch: "bg-violet-500",
  },
  pink: {
    label: "Pink",
    chip: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
    swatch: "bg-pink-500",
  },
};

/** A stored color, or gray when it isn't one the palette knows. */
export function tagColor(color: string): GscTrackerTagColor {
  return GSC_TRACKER_TAG_COLORS.find((known) => known === color) ?? "gray";
}

/** Filter value for phrases without any tag. */
export const UNTAGGED = "untagged";

/** Whether a phrase passes the tag filter: any chosen tag, or no tags at all
 *  when "Untagged" is chosen. An empty filter keeps every phrase. */
export function matchesTagFilter(
  tagIds: string[],
  filter: ReadonlySet<string>,
): boolean {
  if (filter.size === 0) return true;
  if (tagIds.length === 0) return filter.has(UNTAGGED);
  return tagIds.some((id) => filter.has(id));
}

export function useTags(projectId: string) {
  return useQuery({
    queryKey: ["gscTrackerTags", projectId],
    queryFn: () => listGscTrackerTags({ data: { projectId } }),
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
