import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart } from "recharts";
import { cn } from "cn";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  ChartGrid,
  ChartXAxis,
  ChartYAxis,
} from "@/client/components/ChartAxes";
import { Button } from "@/client/components/ui/button";
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
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";
import {
  formatDay,
  formatMetric,
  integer,
  METRIC_LABELS,
  METRICS,
  type CompareRow,
  type Metric,
  type Metrics,
} from "./gscTrackerView";

/** Change from the previous window. For position, lower is better. */
function Delta({
  metric,
  current,
  previous,
}: {
  metric: Metric;
  current: number | null;
  previous: number | null;
}) {
  if (current === null || previous === null) return null;
  const change = current - previous;
  // Changes that round to zero at display precision are not shown.
  const minimum =
    metric === "position" ? 0.05 : metric === "ctr" ? 0.0005 : 0.5;
  if (Math.abs(change) < minimum) return null;
  const better = metric === "position" ? change < 0 : change > 0;
  const text =
    metric === "ctr"
      ? `${(Math.abs(change) * 100).toFixed(1)} pp`
      : metric === "position"
        ? Math.abs(change).toFixed(1)
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
}: {
  series: SeriesPoint[];
  initialMetric?: Metric;
}) {
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
          <Line
            type="monotone"
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

const PAGE_SIZE = 100;

export function CompareTable({
  rows,
  keyLabel,
  onSelect,
}: {
  rows: CompareRow[];
  keyLabel: string;
  onSelect?: (key: string) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  if (rows.length === 0)
    return (
      <EmptyState
        kind="filtered"
        title="Nothing here for this period"
        description="Try a longer period or another view."
      />
    );
  return (
    <div className="space-y-2">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyLabel}</TableHead>
              {METRICS.map((metric) => (
                <TableHead key={metric} className="text-right">
                  {METRIC_LABELS[metric]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, shown).map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-md">
                  {onSelect ? (
                    <button
                      type="button"
                      className="text-left break-all hover:underline"
                      onClick={() => onSelect(row.key)}
                    >
                      {row.key}
                    </button>
                  ) : (
                    <span className="break-all">{row.key}</span>
                  )}
                </TableCell>
                {METRICS.map((metric) => (
                  <TableCell key={metric} className="text-right tabular-nums">
                    <div>{formatMetric(metric, row.current[metric])}</div>
                    <Delta
                      metric={metric}
                      current={row.current[metric]}
                      previous={row.previous[metric]}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {integer.format(Math.min(shown, rows.length))} of{" "}
          {integer.format(rows.length)}
        </span>
        {shown < rows.length ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShown((value) => value + PAGE_SIZE)}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** One query's daily position and clicks, and the pages that rank for it. */
export function QueryDetailDialog({
  projectId,
  query,
  days,
  onClose,
}: {
  projectId: string;
  query: string;
  days: GscTrackerRangeDays;
  onClose: () => void;
}) {
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
            Daily position and the pages that rank for this query.
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

type CannibalQuery = {
  query: string;
  impressions: number;
  clicks: number;
  pages: (Metrics & { url: string; share: number })[];
};

export function CannibalizationList({
  queries,
  onSelect,
}: {
  queries: CannibalQuery[];
  onSelect: (query: string) => void;
}) {
  if (queries.length === 0)
    return (
      <EmptyState
        title="No competing pages found"
        description="No query in this period splits its impressions between two or more of your pages."
      />
    );
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Query</TableHead>
            <TableHead>
              Competing pages (share of impressions · position)
            </TableHead>
            <TableHead className="text-right">Impressions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queries.map((item) => (
            <TableRow key={item.query} className="align-top">
              <TableCell className="max-w-56">
                <button
                  type="button"
                  className="text-left break-all hover:underline"
                  onClick={() => onSelect(item.query)}
                >
                  {item.query}
                </button>
              </TableCell>
              <TableCell>
                <ul className="space-y-1">
                  {item.pages.map((page) => (
                    <li key={page.url} className="text-xs">
                      <span className="break-all">{page.url}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {Math.round(page.share * 100)}% ·{" "}
                        {formatMetric("position", page.position)}
                      </span>
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMetric("impressions", item.impressions)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
