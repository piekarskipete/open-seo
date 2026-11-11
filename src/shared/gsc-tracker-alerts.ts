// GSC Tracker alerts: the rule types a site can watch for, their settings
// and defaults. Shared by the server (which checks them after each sync) and
// the Alerts tab (which edits them).

export const GSC_TRACKER_ALERT_TYPES = [
  "phrase_dropped",
  "phrase_entered_top",
  "phrase_outranked",
  "rank_mismatch",
  "checkpoint_reached",
  "group_traffic_drop",
  "site_traffic_drop",
  "group_pages_lost",
  "sitemap_new_urls",
  "sync_error",
] as const;

export type GscTrackerAlertType = (typeof GSC_TRACKER_ALERT_TYPES)[number];

/** A rule's thresholds and scope. Each type reads the keys it lists. */
export type GscTrackerAlertParams = {
  places?: number;
  top?: number;
  percent?: number;
  share?: number;
  days?: number;
  minImpressions?: number;
  minClicks?: number;
  /** Followed phrases carrying this tag only. */
  tagId?: string;
  /** This page group only. */
  groupId?: string;
};

type NumberParam = Exclude<keyof GscTrackerAlertParams, "tagId" | "groupId">;

type Definition = {
  label: string;
  description: string;
  /** What the rule can be narrowed to. */
  scope: "phrases" | "groups" | "site";
  params: {
    key: NumberParam;
    label: string;
    min: number;
    max: number;
    default: number;
  }[];
  cooldownDays: number;
};

export const GSC_TRACKER_ALERT_DEFINITIONS: Record<
  GscTrackerAlertType,
  Definition
> = {
  phrase_dropped: {
    label: "Phrase dropped",
    description:
      "A followed phrase's latest position is this many places below its average of the 7 days before, on a phrase with real traffic.",
    scope: "phrases",
    params: [
      { key: "places", label: "Places dropped", min: 1, max: 100, default: 10 },
      {
        key: "minImpressions",
        label: "Min. impressions in those 7 days",
        min: 0,
        max: 100000,
        default: 50,
      },
    ],
    cooldownDays: 7,
  },
  phrase_entered_top: {
    label: "Phrase reached the top",
    description:
      "A followed phrase reaches the top N while it averaged below it the 7 days before.",
    scope: "phrases",
    params: [{ key: "top", label: "Top", min: 1, max: 100, default: 3 }],
    cooldownDays: 14,
  },
  phrase_outranked: {
    label: "Another page beat the target",
    description:
      "Another page of yours got more clicks or impressions than a followed phrase's target URL, several days in a row.",
    scope: "phrases",
    params: [
      { key: "days", label: "Days in a row", min: 1, max: 14, default: 3 },
    ],
    cooldownDays: 14,
  },
  rank_mismatch: {
    label: "Rank Tracking disagrees",
    description:
      "This month, fewer of a phrase's days than this share are within 10 places of Rank Tracking (needs a linked Rank Tracking domain).",
    scope: "phrases",
    params: [
      { key: "share", label: "Min. match %", min: 1, max: 100, default: 50 },
      {
        key: "days",
        label: "Min. days compared",
        min: 1,
        max: 31,
        default: 10,
      },
    ],
    cooldownDays: 30,
  },
  checkpoint_reached: {
    label: "Checkpoint reached",
    description:
      "When a checkpoint day's data arrives: where its phrases stood at the start and at the checkpoint.",
    scope: "phrases",
    params: [],
    cooldownDays: 0,
  },
  group_traffic_drop: {
    label: "Page group lost traffic",
    description:
      "A page group's clicks over the last 7 days are this much below the 7 days before.",
    scope: "groups",
    params: [
      { key: "percent", label: "Drop %", min: 1, max: 100, default: 30 },
      {
        key: "minClicks",
        label: "Min. clicks the week before",
        min: 0,
        max: 1000000,
        default: 100,
      },
    ],
    cooldownDays: 7,
  },
  site_traffic_drop: {
    label: "Site lost traffic",
    description:
      "The whole site's clicks over the last 7 days are this much below the 7 days before.",
    scope: "site",
    params: [
      { key: "percent", label: "Drop %", min: 1, max: 100, default: 25 },
      {
        key: "minClicks",
        label: "Min. clicks the week before",
        min: 0,
        max: 10000000,
        default: 200,
      },
    ],
    cooldownDays: 7,
  },
  group_pages_lost: {
    label: "Group page lost its impressions",
    description:
      "A page of a group had at least this many impressions in the month before and none in the last N days.",
    scope: "groups",
    params: [
      {
        key: "days",
        label: "Days without impressions",
        min: 3,
        max: 60,
        default: 21,
      },
      {
        key: "minImpressions",
        label: "Min. impressions the month before",
        min: 1,
        max: 1000000,
        default: 50,
      },
    ],
    cooldownDays: 60,
  },
  sitemap_new_urls: {
    label: "New URLs in a sitemap group",
    description: "A sitemap group's sitemap lists URLs it didn't before.",
    scope: "groups",
    params: [],
    cooldownDays: 0,
  },
  sync_error: {
    label: "Sync problem",
    description:
      "Search Console refused access or didn't answer, or a group's sitemap couldn't be read.",
    scope: "site",
    params: [],
    cooldownDays: 3,
  },
};

/** The rules "Add recommended rules" creates. */
export const GSC_TRACKER_RECOMMENDED_ALERTS: GscTrackerAlertType[] = [
  "phrase_dropped",
  "phrase_entered_top",
  "group_traffic_drop",
  "site_traffic_drop",
  "sync_error",
];

/** A type's thresholds, defaults filled in, clamped to their range. */
export function alertParams(
  type: GscTrackerAlertType,
  raw: GscTrackerAlertParams,
): GscTrackerAlertParams {
  const params: GscTrackerAlertParams = {};
  for (const param of GSC_TRACKER_ALERT_DEFINITIONS[type].params) {
    const value = raw[param.key];
    params[param.key] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(param.max, Math.max(param.min, value))
        : param.default;
  }
  if (raw.tagId) params.tagId = raw.tagId;
  if (raw.groupId) params.groupId = raw.groupId;
  return params;
}

/** Stored params, or none when unreadable. */
export function parseAlertParams(raw: string): GscTrackerAlertParams {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as GscTrackerAlertParams)
      : {};
  } catch {
    return {};
  }
}

export const GSC_TRACKER_WEBHOOK_FORMATS = [
  "json",
  "slack",
  "discord",
] as const;
export type GscTrackerWebhookFormat =
  (typeof GSC_TRACKER_WEBHOOK_FORMATS)[number];
export const GSC_TRACKER_WEBHOOK_MODES = ["instant", "digest"] as const;
export type GscTrackerWebhookMode = (typeof GSC_TRACKER_WEBHOOK_MODES)[number];
