// The period choice shared by the phrase and query charts: a preset number
// of days, or a custom from-to range.

import {
  GSC_TRACKER_CHART_DAYS,
  type GscTrackerChartDays,
} from "@/shared/gsc-tracker";
import { shiftDay } from "@/client/features/gsc-tracker/gscTrackerView";

export type ChartRange = {
  /** A preset in days ("7", "28", …) or "custom". */
  period: string;
  from: string;
  to: string;
};

export const CHART_PERIODS: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "28", label: "28 days" },
  { value: "90", label: "3 months" },
  { value: "180", label: "6 months" },
  { value: "365", label: "12 months" },
  { value: "custom", label: "Custom" },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A range opening on `days` (longer periods open on 12 months; none on
 *  28 days), with a custom range ready to edit: the last 28 days Search
 *  Console has (about two days back). */
export function initialRange(days?: number): ChartRange {
  const preset =
    days !== undefined && days > 365
      ? 365
      : GSC_TRACKER_CHART_DAYS.find((value) => value === days);
  const to = shiftDay(new Date().toISOString().slice(0, 10), -2);
  return { period: `${preset ?? 28}`, from: shiftDay(to, -27), to };
}

/** What to ask the server for, or null while a custom range is incomplete. */
export function rangeRequest(
  range: ChartRange,
): { days: GscTrackerChartDays } | { from: string; to: string } | null {
  if (range.period !== "custom") {
    const days = GSC_TRACKER_CHART_DAYS.find((d) => `${d}` === range.period);
    return { days: days ?? 28 };
  }
  if (!DAY.test(range.from) || !DAY.test(range.to) || range.from > range.to)
    return null;
  return { from: range.from, to: range.to };
}
