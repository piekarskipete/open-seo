import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Input } from "@/client/components/ui/input";
import {
  CHART_PERIODS,
  type ChartRange,
} from "@/client/features/gsc-tracker/gscTrackerRange";

/** Preset periods, or "Custom" with from and to dates. */
export function RangePicker({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (next: ChartRange) => void;
}) {
  const reversed = value.period === "custom" && value.from > value.to;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedToggle
          showLabels
          value={value.period}
          onChange={(period) => onChange({ ...value, period })}
          items={CHART_PERIODS.map((item) => ({ ...item, icon: null }))}
        />
        {value.period === "custom" ? (
          <span className="flex items-center gap-1.5 text-xs">
            <Input
              type="date"
              aria-label="From"
              value={value.from}
              onChange={(event) =>
                onChange({ ...value, from: event.target.value })
              }
              className="h-8 w-36"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To"
              value={value.to}
              onChange={(event) =>
                onChange({ ...value, to: event.target.value })
              }
              className="h-8 w-36"
            />
          </span>
        ) : null}
      </div>
      {reversed ? (
        <p role="alert" className="text-xs text-destructive">
          The start of the range has to come before its end.
        </p>
      ) : null}
    </div>
  );
}
