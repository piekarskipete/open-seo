// Followed phrases beside Rank Tracking: the comparison's shared state and
// math, kept apart from the components so their modules only export
// components.

import { createContext, useContext } from "react";
import type { getGscTrackerRankComparison } from "@/serverFunctions/gscTrackerOverview";
import { comparableUrl } from "@/shared/gsc-tracker";

type RankComparison = Awaited<ReturnType<typeof getGscTrackerRankComparison>>;
type RankDay = { position: number | null; url: string | null };

/** The Keywords tab's Rank Tracking data, for its rows. */
export const RankContext = createContext<{
  projectId: string;
  data: RankComparison | undefined;
} | null>(null);

export function useRank() {
  return useContext(RankContext);
}

/** How a day's Rank Tracking position sits with Search Console's average:
 *  within 3 places it agrees, within 10 it's close, beyond that (or not
 *  found in the checked results) it differs. */
type Agreement = "match" | "close" | "differs";

const MATCH_PLACES = 3;
const CLOSE_PLACES = 10;

export function compareDay(
  gsc: number | undefined,
  rank: RankDay | undefined,
): Agreement | null {
  if (gsc === undefined || rank === undefined) return null;
  if (rank.position === null) return "differs";
  const gap = Math.abs(gsc - rank.position);
  if (gap <= MATCH_PLACES) return "match";
  if (gap <= CLOSE_PLACES) return "close";
  return "differs";
}

/** A phrase's month: how many days both sources measured, how many of them
 *  agree, the overall verdict, the latest Rank Tracking day, and whether
 *  Rank Tracking found another URL than the target on that day. */
export function summarizeRank(input: {
  gscDays: Record<string, { position: number }>;
  rankDays: Record<string, RankDay>;
  targetUrl: string;
}) {
  const dates = Object.keys(input.rankDays);
  dates.sort();
  let compared = 0;
  let agreeing = 0;
  for (const date of dates) {
    const verdict = compareDay(
      input.gscDays[date]?.position,
      input.rankDays[date],
    );
    if (verdict === null) continue;
    compared += 1;
    if (verdict !== "differs") agreeing += 1;
  }
  const latestDate = dates[dates.length - 1];
  const latest = latestDate ? input.rankDays[latestDate] : undefined;
  return {
    compared,
    agreeing,
    verdict:
      compared === 0
        ? null
        : agreeing / compared >= 0.7
          ? ("agrees" as const)
          : ("differs" as const),
    latest: latest ?? null,
    otherUrl:
      latest?.url &&
      comparableUrl(latest.url) !== comparableUrl(input.targetUrl)
        ? latest.url
        : null,
  };
}

export const AGREEMENT_TONES: Record<Agreement, string> = {
  match: "border-success/60 bg-success/10",
  close: "border-warning/60 bg-warning/10",
  differs: "border-destructive/60 bg-destructive/10",
};
