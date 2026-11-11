// Followed phrases beside Rank Tracking: how a day's Rank Tracking position
// sits with Search Console's, and a phrase's month of them. Shared by the
// Keywords tab and the alerts.

import { comparableUrl } from "./gsc-tracker";

type RankDay = { position: number | null; url: string | null };

/** How a day's Rank Tracking position sits with Search Console's average:
 *  within 3 places it agrees, within 10 it's close, beyond that (or not
 *  found in the checked results) it differs. */
export type Agreement = "match" | "close" | "differs";

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
