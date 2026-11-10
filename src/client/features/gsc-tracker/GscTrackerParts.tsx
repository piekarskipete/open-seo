import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ReferenceLine } from "recharts";
import { cn } from "cn";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { getGscTrackerQuery } from "@/serverFunctions/gscTracker";
import { TrackPageButton } from "@/client/features/gsc-tracker/GscTrackerTrackButton";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";
import {
  formatDay,
  formatPosition,
  useFormatMetric,
  usePositionFormat,
  integer,
  METRIC_LABELS,
  METRICS,
  type Metric,
  type Metrics,
} from "./gscTrackerView";

/** Change from the previous window. For position, lower is better. */
export function Delta({
  metric,
  current,
  previous,
}: {
  metric: Metric;
  current: number | null;
  previous: number | null;
}) {
  const positionFormat = usePositionFormat();
  if (current === null || previous === null) return null;
  const change = current - previous;
  // Changes that round to zero at display precision are not shown.
  const minimum =
    metric === "position"
      ? positionFormat === "whole"
        ? 0.5
        : 0.05
      : metric === "ctr"
        ? 0.0005
        : 0.5;
  if (Math.abs(change) < minimum) return null;
  const better = metric === "position" ? change < 0 : change > 0;
  const text =
    metric === "ctr"
      ? `${(Math.abs(change) * 100).toFixed(1)} pp`
      : metric === "position"
        ? formatPosition(Math.abs(change), positionFormat)
        : integer.format(Math.abs(change));
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        better ? "text-success" : "text-destructive",
      )}
    >
      {(metric === "position" ? change < 0 : change > 0) ? "▲" : "▼"} {text}
    </span>
  );
}

export function StatTiles({
  current,
  previous,
}: {
  current: Metrics;
  previous: Metrics;
}) {
  const formatMetric = useFormatMetric();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {METRICS.map((metric) => (
        <div key={metric} className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">
            {METRIC_LABELS[metric]}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatMetric(metric, current[metric])}
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Delta
              metric={metric}
              current={current[metric]}
              previous={previous[metric]}
            />
            <span>vs previous period</span>
          </div>
        </div>
      ))}
    </div>
  );
}

type SeriesPoint = { date: string } & Record<Metric, number | null>;

export function TrendChart({
  series,
  initialMetric = "clicks",
  start,
}: {
  series: SeriesPoint[];
  initialMetric?: Metric;
  /** A followed phrase's start: its date, and its position then. */
  start?: { date: string; position: number | null };
}) {
  const formatMetric = useFormatMetric();
  const startInRange =
    start !== undefined && series.some((point) => point.date === start.date);
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const config: ChartConfig = {
    [metric]: { label: METRIC_LABELS[metric], color: "var(--chart-1)" },
  };
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <SegmentedToggle
        showLabels
        value={metric}
        onChange={setMetric}
        items={METRICS.map((value) => ({
          value,
          icon: null,
          label: METRIC_LABELS[value],
        }))}
      />
      <ChartContainer config={config} className="h-64 w-full">
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0 }}>
          <ChartGrid />
          <ChartXAxis
            dataKey="date"
            tickFormatter={(value: string) =>
              new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            }
          />
          <ChartYAxis
            reversed={metric === "position"}
            tickFormatter={(value: number) => formatMetric(metric, value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) =>
                  typeof label === "string" ? formatDay(label) : ""
                }
                valueFormatter={(value) =>
                  formatMetric(metric, typeof value === "number" ? value : null)
                }
              />
            }
          />
          {startInRange ? (
            <ReferenceLine
              x={start.date}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: "Start",
                position: "insideTopLeft",
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
            />
          ) : null}
          {metric === "position" && start?.position != null ? (
            <ReferenceLine
              y={start.position}
              stroke="var(--chart-2)"
              strokeDasharray="4 4"
              label={{
                value: `Start position ${formatMetric("position", start.position)}`,
                position: "insideBottomRight",
                fontSize: 11,
                fill: "var(--chart-2)",
              }}
            />
          ) : null}
          <Line
            type="monotone"
            connectNulls
            dataKey={metric}
            stroke={`var(--color-${metric})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

/** One query's daily position and clicks, and the pages that rank for it. */
export function QueryDetailDialog({
  projectId,
  canManage,
  query,
  days,
  onClose,
}: {
  projectId: string;
  /** Members who manage integrations can add a page to the tracker. */
  canManage: boolean;
  query: string;
  days: GscTrackerRangeDays;
  onClose: () => void;
}) {
  const formatMetric = useFormatMetric();
  const detail = useQuery({
    queryKey: ["gscTrackerQuery", projectId, query, days],
    queryFn: () => getGscTrackerQuery({ data: { projectId, query, days } }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all">{query}</DialogTitle>
          <DialogDescription>
            Daily position and the pages that rank for this query. Add a page to
            the tracker to follow the query with that page as its target.
          </DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : detail.isError ? (
          <QueryError
            error={detail.error}
            fallback="Couldn't load this query."
            onRetry={() => void detail.refetch()}
            isRetrying={detail.isFetching}
          />
        ) : detail.data ? (
          <div className="space-y-4">
            <TrendChart series={detail.data.series} initialMetric="position" />
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                    <TableHead className="text-right">Position</TableHead>
                    {canManage ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.data.pages.map((page) => (
                    <TableRow key={page.url}>
                      <TableCell className="max-w-md break-all">
                        {page.url}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetric("clicks", page.clicks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetric("impressions", page.impressions)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMetric("position", page.position)}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <TrackPageButton
                            projectId={projectId}
                            query={query}
                            url={page.url}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
