/** Window lengths the tracker compares, in days; 480 is Google's 16 months. */
export const GSC_TRACKER_RANGE_DAYS = [7, 28, 90, 180, 365, 480] as const;

export type GscTrackerRangeDays = (typeof GSC_TRACKER_RANGE_DAYS)[number];

export const GSC_TRACKER_TABS = [
  "overview",
  "queries",
  "pages",
  "cannibalization",
] as const;

export type GscTrackerTab = (typeof GSC_TRACKER_TABS)[number];
