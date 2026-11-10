// Formatting and list logic for the GSC Tracker page, kept apart from the
// components so the component modules only export components.

import { createContext, useContext } from "react";
import type {
  GscTrackerDateFormat,
  GscTrackerPositionFormat,
  GscTrackerSortKey,
} from "@/shared/gsc-tracker";

export type Metrics = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export type CompareRow = {
  key: string;
  /** Pages the query reached in the current period (Query Explorer only). */
  urls?: number;
  current: Metrics;
  previous: Metrics;
};

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

/** The project's day-label format, set by the tracker page. */
export const DateFormatContext = createContext<GscTrackerDateFormat>("dd.mm");

export function useDateFormat(): GscTrackerDateFormat {
  return useContext(DateFormatContext);
}

/** A YYYY-MM-DD day as the project labels it: "03.10" or "Oct 3". */
export function formatDayLabel(
  day: string,
  dateFormat: GscTrackerDateFormat,
): string {
  if (dateFormat === "dd.mm") return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

/** YYYY-MM-DD shifted by whole days. */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type SortState = { key: GscTrackerSortKey; dir: "asc" | "desc" };

/** The natural first order: most clicks, impressions or CTR, best position. */
export function defaultSort(key: GscTrackerSortKey): SortState {
  return { key, dir: key === "position" ? "asc" : "desc" };
}

/** Clicking the active column flips it; another column starts natural. */
export function nextSort(
  current: SortState | null,
  key: GscTrackerSortKey,
): SortState {
  if (current?.key === key)
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return defaultSort(key);
}

/** Rows ordered by the current period's value; rows without one go last. */
export function sortRows(rows: CompareRow[], sort: SortState): CompareRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const left = sort.key === "urls" ? (a.urls ?? null) : a.current[sort.key];
    const right = sort.key === "urls" ? (b.urls ?? null) : b.current[sort.key];
    if (left === null || right === null)
      return (left === null ? 1 : 0) - (right === null ? 1 : 0);
    return (left - right) * sign;
  });
  return sorted;
}
