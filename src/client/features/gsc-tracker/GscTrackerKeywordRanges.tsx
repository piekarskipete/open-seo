import { cn } from "cn";
import {
  formatDay,
  METRIC_LABELS,
  METRICS,
  useFormatMetric,
} from "@/client/features/gsc-tracker/gscTrackerView";
import type { getGscTrackerKeywordChart } from "@/serverFunctions/gscTracker";

type Chart = Awaited<ReturnType<typeof getGscTrackerKeywordChart>>;
type Range = Chart["sinceStart"];
type Point = { date: string; position: number } | null;

/** The start and checkpoint days under the chart, with the position on each. */
export function MarkerLegend({ markers }: { markers: Chart["markers"] }) {
  const formatMetric = useFormatMetric();
  const rows: { label: string; date: string; point: Point; note: string }[] = [
    {
      label: "Start",
      date: markers.start.date,
      point: markers.start.point,
      note: "first measured day from then on",
    },
    ...markers.checkpoints.map((checkpoint, index) => ({
      label: `Checkpoint ${index + 1}`,
      date: checkpoint.date,
      point: checkpoint.point,
      note: "last measured day up to it",
    })),
  ];
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((row) => (
        <li key={row.label} className="flex flex-wrap items-center gap-x-2">
          <span className="inline-block w-5 border-t border-dashed border-muted-foreground" />
          <span className="font-medium">{row.label}</span>
          <span>{formatDay(row.date)}</span>
          <span className="text-muted-foreground">·</span>
          <span>
            position{" "}
            <span className="font-medium tabular-nums">
              {formatMetric("position", row.point?.position ?? null)}
            </span>
          </span>
          {row.point && row.point.date !== row.date ? (
            <span className="text-muted-foreground">
              (measured {formatDay(row.point.date)}, the {row.note})
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One stretch: the position at each end with the move, and its totals. */
export function RangeCard({ title, range }: { title: string; range: Range }) {
  const formatMetric = useFormatMetric();
  const change = range.change;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">
          {formatDay(range.from)} – {formatDay(range.to)}
        </div>
      </div>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-xl font-semibold">
          {formatMetric("position", range.first?.position ?? null)} →{" "}
          {formatMetric("position", range.last?.position ?? null)}
        </span>
        {change !== null && Math.abs(change) >= 0.05 ? (
          <span
            className={cn(
              "text-sm",
              change > 0 ? "text-success" : "text-destructive",
            )}
          >
            {change > 0 ? "▲" : "▼"}{" "}
            {formatMetric("position", Math.abs(change))}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-4 gap-2 text-xs">
        {METRICS.map((metric) => (
          <div key={metric}>
            <dt className="text-muted-foreground">
              {metric === "position" ? "Avg. position" : METRIC_LABELS[metric]}
            </dt>
            <dd className="font-medium tabular-nums">
              {formatMetric(metric, range[metric])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
