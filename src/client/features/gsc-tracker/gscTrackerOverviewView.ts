// Helpers for the Overview widgets, kept apart from their components so the
// component modules only export components.

import type { CompareRow } from "@/client/features/gsc-tracker/gscTrackerView";
import type {
  GscTrackerTab,
  GscTrackerWidget,
  GscTrackerWidgetType,
} from "@/shared/gsc-tracker";

/** Opens a tracker tab, a page group on the Page Groups tab. */
export type WidgetOpen = (tab: GscTrackerTab, group?: string) => void;

/** Rows ordered by the change in clicks, biggest gain first. */
export function byClickGain(rows: CompareRow[]) {
  const sorted = [...rows];
  sorted.sort(
    (a, b) =>
      b.current.clicks -
      b.previous.clicks -
      (a.current.clicks - a.previous.clicks),
  );
  return sorted;
}

/** The widgets one can add, with what each shows. */
export const WIDGET_KINDS: {
  value: GscTrackerWidgetType;
  label: string;
  description: string;
}[] = [
  {
    value: "totals",
    label: "Site totals",
    description:
      "Clicks, impressions, CTR and position of the whole site, with its daily chart.",
  },
  {
    value: "keywords",
    label: "Followed phrases",
    description:
      "Followed phrases since their start: how many moved up or down, and the biggest moves. Pick a tag to follow only its phrases.",
  },
  {
    value: "queries",
    label: "Query Explorer",
    description:
      "Queries with impressions, new, lost, improved and declined ones, and the biggest click gains.",
  },
  {
    value: "pages",
    label: "Pages and groups",
    description:
      "Pages with new and lost ones, your groups by clicks, and the pages gaining most.",
  },
  {
    value: "group",
    label: "One page group",
    description:
      "A page group's totals against the previous period, and its pages gaining most.",
  },
  {
    value: "checkpoints",
    label: "Checkpoints",
    description:
      "Followed phrases grouped by their checkpoint days: average position at the start, at each checkpoint and now, and how many moved up or down.",
  },
  {
    value: "cannibalization",
    label: "Competing pages",
    description:
      "Queries split between your pages, with their impressions and clicks.",
  },
];

/** A widget's name in the Customize view. */
export function widgetLabel(
  widget: GscTrackerWidget,
  names: {
    tags: { id: string; name: string }[];
    groups: { id: string; name: string }[];
  },
): string {
  const label =
    WIDGET_KINDS.find((item) => item.value === widget.type)?.label ??
    widget.type;
  if (widget.type === "keywords" && widget.tagId)
    return `${label}: ${names.tags.find((tag) => tag.id === widget.tagId)?.name ?? "removed tag"}`;
  if (widget.type === "group")
    return `Group: ${names.groups.find((group) => group.id === widget.groupId)?.name ?? "…"}`;
  return label;
}
