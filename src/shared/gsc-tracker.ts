/** Window lengths the tracker compares, in days; 480 is Google's 16 months. */
export const GSC_TRACKER_RANGE_DAYS = [7, 28, 90, 180, 365, 480] as const;

export type GscTrackerRangeDays = (typeof GSC_TRACKER_RANGE_DAYS)[number];

export const GSC_TRACKER_TABS = [
  "keywords",
  "explorer",
  "overview",
  "cannibalization",
] as const;

export type GscTrackerTab = (typeof GSC_TRACKER_TABS)[number];

/** How positions are shown: "decimal" (7.4) or "whole" (7). */
export const GSC_TRACKER_POSITION_FORMATS = ["decimal", "whole"] as const;

export type GscTrackerPositionFormat =
  (typeof GSC_TRACKER_POSITION_FORMATS)[number];

/** Columns Query Explorer sorts by, and a project's default order. */
export const GSC_TRACKER_SORT_KEYS = [
  "clicks",
  "impressions",
  "ctr",
  "position",
] as const;

export type GscTrackerSortKey = (typeof GSC_TRACKER_SORT_KEYS)[number];

/** Search Console reports queries lowercased with single spaces. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A URL reduced to what decides "the same page": no scheme, "www.",
 *  fragment or trailing slash, so a target typed by hand still matches. */
export function comparableUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/#.*$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}
