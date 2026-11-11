// Followed phrases beside Rank Tracking: the comparison's shared state and
// math, kept apart from the components so their modules only export
// components.

import { createContext, useContext } from "react";
import type { getGscTrackerRankComparison } from "@/serverFunctions/gscTrackerOverview";
import type { Agreement } from "@/shared/gsc-tracker-rank";

type RankComparison = Awaited<ReturnType<typeof getGscTrackerRankComparison>>;

/** The Keywords tab's Rank Tracking data, for its rows. */
export const RankContext = createContext<{
  projectId: string;
  data: RankComparison | undefined;
} | null>(null);

export function useRank() {
  return useContext(RankContext);
}

// Rank Tracking marks stay clear of green and red, which the Search Console
// row uses for a day's move up or down.
export const AGREEMENT_STYLES: Record<
  Agreement,
  { cell: string; mark: string; symbol: string; label: string }
> = {
  match: {
    cell: "border-info/40 bg-info/5",
    mark: "text-info",
    symbol: "✓",
    label: "Same as Search Console (up to 3 places apart)",
  },
  close: {
    cell: "border-warning/60 bg-warning/10",
    mark: "text-warning-foreground dark:text-warning",
    symbol: "~",
    label: "Close (4 to 10 places apart)",
  },
  differs: {
    cell: "border-orange-500/70 bg-orange-500/15",
    mark: "text-orange-600 dark:text-orange-400",
    symbol: "!",
    label: "Different (more than 10 places apart, or not found)",
  },
};

/** How many places Rank Tracking sits from Search Console's average:
 *  "+5" means 5 places lower down the results. */
export function placesApart(gsc: number, rank: number): string {
  const gap = Math.round(rank - gsc);
  if (gap === 0) return "0";
  return gap > 0 ? `+${gap}` : `−${Math.abs(gap)}`;
}
