/** Window lengths the tracker compares, in days; 480 is Google's 16 months. */
export const GSC_TRACKER_RANGE_DAYS = [7, 28, 90, 180, 365, 480] as const;

export type GscTrackerRangeDays = (typeof GSC_TRACKER_RANGE_DAYS)[number];

export const GSC_TRACKER_TABS = [
  "keywords",
  "explorer",
  "pages",
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
  "urls",
] as const;

export type GscTrackerSortKey = (typeof GSC_TRACKER_SORT_KEYS)[number];

/** How day labels read: "dd.mm" (03.10) or "mon-d" (Oct 3). */
export const GSC_TRACKER_DATE_FORMATS = ["dd.mm", "mon-d"] as const;

export type GscTrackerDateFormat = (typeof GSC_TRACKER_DATE_FORMATS)[number];

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

/** The longest tag name, in characters. */
export const GSC_TRACKER_TAG_NAME_MAX = 40;

/** Periods a followed phrase's chart can show, in days. */
export const GSC_TRACKER_CHART_DAYS = [7, 28, 90, 180, 365] as const;

export type GscTrackerChartDays = (typeof GSC_TRACKER_CHART_DAYS)[number];

/** How a page group picks its URLs: by hand, from a sitemap, every page
 *  under a directory, or every page matching a regular expression. */
export const GSC_TRACKER_GROUP_KINDS = [
  "manual",
  "sitemap",
  "directory",
  "regex",
] as const;

export type GscTrackerGroupKind = (typeof GSC_TRACKER_GROUP_KINDS)[number];

/** The longest page group name, in characters. */
export const GSC_TRACKER_GROUP_NAME_MAX = 60;

/** How the page list's URL filter reads its text. */
export const GSC_TRACKER_URL_FILTER_MODES = [
  "contains",
  "regex",
  "list",
  "sitemap",
] as const;

export type GscTrackerUrlFilterMode =
  (typeof GSC_TRACKER_URL_FILTER_MODES)[number];

/** Widgets the Overview tab can show. "keywords" can be narrowed to a tag,
 *  "group" names a page group. */
export const GSC_TRACKER_WIDGET_TYPES = [
  "totals",
  "keywords",
  "queries",
  "pages",
  "group",
  "cannibalization",
] as const;

export type GscTrackerWidgetType = (typeof GSC_TRACKER_WIDGET_TYPES)[number];

export type GscTrackerWidget = {
  id: string;
  type: GscTrackerWidgetType;
  /** "half" shares a row with another half widget. */
  size: "half" | "full";
  tagId?: string;
  groupId?: string;
};

/** The most widgets one Overview holds. */
export const GSC_TRACKER_MAX_WIDGETS = 24;

/** The Overview a site starts with. */
export const DEFAULT_GSC_TRACKER_WIDGETS: GscTrackerWidget[] = [
  { id: "totals", type: "totals", size: "full" },
  { id: "keywords", type: "keywords", size: "half" },
  { id: "queries", type: "queries", size: "half" },
  { id: "pages", type: "pages", size: "half" },
  { id: "cannibalization", type: "cannibalization", size: "half" },
];

/** A stored layout, or the default when it is missing or unreadable. */
export function parseOverviewLayout(raw: string | null): GscTrackerWidget[] {
  if (!raw) return DEFAULT_GSC_TRACKER_WIDGETS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_GSC_TRACKER_WIDGETS;
    return parsed.flatMap((item: unknown): GscTrackerWidget[] => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const type = GSC_TRACKER_WIDGET_TYPES.find(
        (value) => value === entry.type,
      );
      if (!type || typeof entry.id !== "string") return [];
      return [
        {
          id: entry.id,
          type,
          size: entry.size === "full" ? "full" : "half",
          ...(typeof entry.tagId === "string" ? { tagId: entry.tagId } : {}),
          ...(typeof entry.groupId === "string"
            ? { groupId: entry.groupId }
            : {}),
        },
      ];
    });
  } catch {
    return DEFAULT_GSC_TRACKER_WIDGETS;
  }
}

/** A URL rule Cannibalization leaves out: text the URL contains (such as
 *  "?fbclid=") or a regular expression. Inactive rules are kept, unapplied. */
export type GscTrackerExclusion = {
  id: string;
  mode: "contains" | "regex";
  pattern: string;
  active: boolean;
};

/** The most exclusions one site keeps. */
export const GSC_TRACKER_MAX_EXCLUSIONS = 50;

/** Stored exclusions; none when missing or unreadable. */
export function parseCannibalExclusions(
  raw: string | null,
): GscTrackerExclusion[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown): GscTrackerExclusion[] => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.pattern !== "string")
        return [];
      return [
        {
          id: entry.id,
          mode: entry.mode === "regex" ? "regex" : "contains",
          pattern: entry.pattern,
          active: entry.active !== false,
        },
      ];
    });
  } catch {
    return [];
  }
}
