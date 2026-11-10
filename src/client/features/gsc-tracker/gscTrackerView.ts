// Formatting and list logic for the GSC Tracker page, kept apart from the
// components so the component modules only export components.

import { createContext, useContext } from "react";
import type { GscTrackerPositionFormat } from "@/shared/gsc-tracker";

export type Metrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export type CompareRow = { key: string; current: Metrics; previous: Metrics };

export type Metric = "clicks" | "impressions" | "ctr" | "position";

export const METRICS: Metric[] = ["clicks", "impressions", "ctr", "position"];

export const METRIC_LABELS: Record<Metric, string> = {
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "CTR",
  position: "Position",
};

export const integer = new Intl.NumberFormat("en-US");

/** The project's position format, set by the tracker page. */
export const PositionFormatContext =
  createContext<GscTrackerPositionFormat>("decimal");

export function usePositionFormat(): GscTrackerPositionFormat {
  return useContext(PositionFormatContext);
}

/** A position as the project shows it: 7.4, or 7 when set to whole numbers. */
export function formatPosition(
  value: number,
  positionFormat: GscTrackerPositionFormat,
): string {
  return positionFormat === "whole"
    ? String(Math.round(value))
    : value.toFixed(1);
}

export function formatMetric(
  metric: Metric,
  value: number | null,
  positionFormat: GscTrackerPositionFormat = "decimal",
): string {
  if (value === null) return "–";
  if (metric === "ctr") return `${(value * 100).toFixed(1)}%`;
  if (metric === "position") return formatPosition(value, positionFormat);
  return integer.format(value);
}

/** formatMetric bound to the project's position format. */
export function useFormatMetric() {
  const positionFormat = usePositionFormat();
  return (metric: Metric, value: number | null) =>
    formatMetric(metric, value, positionFormat);
}

export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type ListFilter = "all" | "improved" | "declined" | "new" | "lost";

export const LIST_FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "improved", label: "Improved" },
  { value: "declined", label: "Declined" },
  { value: "new", label: "New" },
  { value: "lost", label: "Lost" },
];

// Position moves smaller than this read as noise, not a change.
const POSITION_STEP = 1;

function positionChange(row: CompareRow): number | null {
  if (row.current.position === null || row.previous.position === null)
    return null;
  return row.current.position - row.previous.position;
}

/** Filters and sorts a comparison list for the chosen view. */
export function applyListFilter(
  rows: CompareRow[],
  filter: ListFilter,
): CompareRow[] {
  const change = (row: CompareRow) => positionChange(row) ?? 0;
  const views: Record<
    ListFilter,
    {
      keep: (row: CompareRow) => boolean;
      order: (a: CompareRow, b: CompareRow) => number;
    }
  > = {
    improved: {
      keep: (row) => change(row) <= -POSITION_STEP,
      order: (a, b) => change(a) - change(b),
    },
    declined: {
      keep: (row) => change(row) >= POSITION_STEP,
      order: (a, b) => change(b) - change(a),
    },
    new: {
      keep: (row) =>
        row.previous.impressions === 0 && row.current.impressions > 0,
      order: (a, b) => b.current.impressions - a.current.impressions,
    },
    lost: {
      keep: (row) =>
        row.current.impressions === 0 && row.previous.impressions > 0,
      order: (a, b) => b.previous.clicks - a.previous.clicks,
    },
    all: {
      keep: (row) => row.current.impressions > 0,
      order: (a, b) =>
        b.current.clicks - a.current.clicks ||
        b.current.impressions - a.current.impressions,
    },
  };
  const view = views[filter];
  const list = rows.filter(view.keep);
  list.sort(view.order);
  return list;
}
