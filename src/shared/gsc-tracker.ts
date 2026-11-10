/** Window lengths the tracker compares, in days; 480 is Google's 16 months. */
export const GSC_TRACKER_RANGE_DAYS = [7, 28, 90, 180, 365, 480] as const;

export type GscTrackerRangeDays = (typeof GSC_TRACKER_RANGE_DAYS)[number];

export const GSC_TRACKER_TABS = [
  "keywords",
  "overview",
  "queries",
  "pages",
  "cannibalization",
] as const;

export type GscTrackerTab = (typeof GSC_TRACKER_TABS)[number];

/** How positions are shown: "decimal" (7.4) or "whole" (7). */
export const GSC_TRACKER_POSITION_FORMATS = ["decimal", "whole"] as const;

export type GscTrackerPositionFormat =
  (typeof GSC_TRACKER_POSITION_FORMATS)[number];
