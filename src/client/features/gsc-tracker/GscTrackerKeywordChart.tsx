import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Skeleton } from "@/client/components/ui/skeleton";
import { RangePicker } from "@/client/features/gsc-tracker/GscTrackerRangePicker";
import {
  initialRange,
  rangeRequest,
  type ChartRange,
} from "@/client/features/gsc-tracker/gscTrackerRange";
import {
  MarkerLegend,
  RangeCard,
} from "@/client/features/gsc-tracker/GscTrackerKeywordRanges";
import {
  Delta,
  TrendChart,
} from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  formatDay,
  METRIC_LABELS,
  METRICS,
  useFormatMetric,
  type Metric,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  getGscTrackerKeywordChart,
  type getGscTrackerKeywords,
} from "@/serverFunctions/gscTracker";

type Keyword = Awaited<
  ReturnType<typeof getGscTrackerKeywords>
>["keywords"][number];
type Chart = Awaited<ReturnType<typeof getGscTrackerKeywordChart>>;

const perDay = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A followed phrase on its target URL over time, with its start marked. */
export function KeywordChartDialog({
  projectId,
  keyword,
  onClose,
}: {
  projectId: string;
  keyword: Keyword;
  onClose: () => void;
}) {
  const [range, setRange] = useState<ChartRange>(() => initialRange());
  const request = rangeRequest(range);
  const chart = useQuery({
    queryKey: ["gscTrackerKeywordChart", projectId, keyword.id, request],
    queryFn: () =>
      getGscTrackerKeywordChart({
        data: { projectId, id: keyword.id, ...request },
      }),
    enabled: request !== null,
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all">{keyword.query}</DialogTitle>
          <DialogDescription className="break-all">
            {keyword.targetUrl}
          </DialogDescription>
        </DialogHeader>
        <RangePicker value={range} onChange={setRange} />
        {chart.isPending ? (
          <Skeleton className="h-80 w-full" />
        ) : chart.isError ? (
          <QueryError
            error={chart.error}
            fallback="Couldn't load this phrase's chart."
            onRetry={() => void chart.refetch()}
            isRetrying={chart.isFetching}
          />
        ) : (
          <div className="space-y-3">
            <PeriodTiles chart={chart.data} />
            <TrendChart
              series={chart.data.series}
              initialMetric="position"
              markers={[
                { date: chart.data.markers.start.date, label: "Start" },
                ...chart.data.markers.checkpoints.map((checkpoint, index) => ({
                  date: checkpoint.date,
                  label: `CP${index + 1}`,
                })),
              ]}
              startPosition={chart.data.markers.start.point?.position ?? null}
            />
            <MarkerLegend markers={chart.data.markers} />
            <p className="text-xs text-muted-foreground">
              {formatDay(chart.data.start)} – {formatDay(chart.data.end)}, the
              target URL only. Dashed lines outside this period aren&apos;t
              drawn; the dotted line is the start position.
              {chart.data.oldestDate && chart.data.oldestDate > chart.data.start
                ? ` Days before ${formatDay(chart.data.oldestDate)} aren't fetched yet, so the period is partly empty.`
                : ""}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <RangeCard title="Since start" range={chart.data.sinceStart} />
              {chart.data.checkpointRange ? (
                <RangeCard
                  title={`${chart.data.checkpointRange.fromLabel} → ${chart.data.checkpointRange.toLabel}`}
                  range={chart.data.checkpointRange}
                />
              ) : (
                <p className="self-center text-xs text-muted-foreground">
                  Add a checkpoint (open the phrase, then Checkpoints) to
                  measure start → checkpoint, or checkpoint 1 → checkpoint 2.
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The period's totals and averages, each against the previous period. */
function PeriodTiles({ chart }: { chart: Chart }) {
  const formatMetric = useFormatMetric();
  const notes: Record<Metric, string> = {
    clicks: `avg ${perDay.format(chart.perDay.clicks)} / day`,
    impressions: `avg ${perDay.format(chart.perDay.impressions)} / day`,
    ctr: "average CTR",
    position: "average position",
  };
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {METRICS.map((metric) => (
        <div key={metric} className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground">
            {METRIC_LABELS[metric]}
          </div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatMetric(metric, chart.current[metric])}
          </div>
          <div className="text-xs text-muted-foreground">{notes[metric]}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Delta
              metric={metric}
              current={chart.current[metric]}
              previous={chart.previous[metric]}
            />
            <span>vs previous period</span>
          </div>
        </div>
      ))}
    </div>
  );
}
