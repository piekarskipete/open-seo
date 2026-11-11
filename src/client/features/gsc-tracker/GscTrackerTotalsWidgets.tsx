import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Delta,
  StatTiles,
  TrendChart,
} from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  ClicksChange,
  TopList,
  Widget,
} from "@/client/features/gsc-tracker/GscTrackerWidgetParts";
import { EMPTY_PAGE_FILTER } from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import {
  byClickGain,
  type WidgetOpen,
} from "@/client/features/gsc-tracker/gscTrackerOverviewView";
import {
  formatDay,
  integer,
  METRIC_LABELS,
  METRICS,
  useFormatMetric,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getGscTrackerOverview } from "@/serverFunctions/gscTracker";
import { getGscTrackerCheckpoints } from "@/serverFunctions/gscTrackerOverview";
import {
  getGscTrackerGroup,
  listGscTrackerPages,
} from "@/serverFunctions/gscTrackerGroups";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

/** The site's whole-property totals and daily chart. */
export function TotalsWidget({
  projectId,
  days,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
}) {
  const siteId = useSiteId();
  const overview = useQuery({
    queryKey: ["gscTrackerOverview", siteId, days],
    queryFn: () => getGscTrackerOverview({ data: { projectId, siteId, days } }),
    placeholderData: keepPreviousData,
  });
  if (overview.isPending) return <Skeleton className="h-80 w-full" />;
  if (overview.isError)
    return (
      <QueryError
        error={overview.error}
        fallback="Couldn't load the totals."
        onRetry={() => void overview.refetch()}
        isRetrying={overview.isFetching}
      />
    );
  if (!overview.data) return null;
  return (
    <div className="space-y-3">
      <StatTiles
        current={overview.data.current}
        previous={overview.data.previous}
      />
      <TrendChart series={overview.data.series} />
      <p className="text-xs text-muted-foreground">
        {formatDay(overview.data.currentStart)} –{" "}
        {formatDay(overview.data.currentEnd)}, compared with{" "}
        {formatDay(overview.data.previousStart)} –{" "}
        {formatDay(overview.data.previousEnd)}. Totals include anonymized
        queries.
      </p>
    </div>
  );
}

/** One page group: its totals and the pages gaining most. */
export function GroupWidget({
  projectId,
  days,
  groupId,
  onOpen,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  groupId: string;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const formatMetric = useFormatMetric();
  const group = useQuery({
    queryKey: ["gscTrackerGroup", siteId, groupId, days],
    queryFn: () =>
      getGscTrackerGroup({ data: { projectId, siteId, groupId, days } }),
    retry: false,
  });
  const pages = useQuery({
    queryKey: ["gscTrackerPages", siteId, groupId, days, EMPTY_PAGE_FILTER],
    queryFn: () =>
      listGscTrackerPages({
        data: { projectId, siteId, days, groupId, urlMode: "contains" },
      }),
    enabled: group.isSuccess,
  });
  const totals = group.data?.totals;
  const gainers = byClickGain(pages.data?.rows ?? []).filter(
    (row) => row.current.clicks > row.previous.clicks,
  );
  return (
    <Widget
      title={group.data ? `Group: ${group.data.name}` : "Page group"}
      onOpen={() => onOpen("pages", groupId)}
      loading={group.isPending}
    >
      {group.isError ? (
        <p className="text-sm text-muted-foreground">
          This group no longer exists. Remove the widget in Customize.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {METRICS.map((metric) => (
              <div key={metric}>
                <p className="text-xs text-muted-foreground">
                  {METRIC_LABELS[metric]}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMetric(metric, totals?.current[metric] ?? null)}
                </p>
                <Delta
                  metric={metric}
                  current={totals?.current[metric] ?? null}
                  previous={totals?.previous[metric] ?? null}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {integer.format(group.data?.urls ?? 0)} URLs
          </p>
          <TopList
            title="Pages with most clicks gained"
            empty="No page of the group gained clicks in this period."
            rows={gainers.slice(0, 4).map((row) => ({
              key: row.key,
              label: row.key,
              value: <ClicksChange row={row} />,
            }))}
          />
        </>
      )}
    </Widget>
  );
}

/** Followed phrases grouped by their checkpoint days, newest first. */
export function CheckpointsWidget({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const formatMetric = useFormatMetric();
  const summary = useQuery({
    queryKey: ["gscTrackerCheckpoints", siteId],
    queryFn: () => getGscTrackerCheckpoints({ data: { projectId, siteId } }),
  });
  const cohorts = summary.data?.cohorts ?? [];
  return (
    <Widget
      title="Checkpoints"
      onOpen={() => onOpen("keywords")}
      loading={summary.isPending}
    >
      {cohorts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No phrase has a checkpoint yet. Set one on the Keywords tab to compare
          where phrases stood then with their start and now.
        </p>
      ) : (
        <div className="space-y-4">
          {cohorts.slice(0, 4).map((cohort) => {
            const steps = [
              { label: "Start", value: cohort.average.start },
              ...cohort.checkpoints.map((date, index) => ({
                label: formatDay(date),
                value: cohort.average.checkpoints[index] ?? null,
              })),
              { label: "Now", value: cohort.average.now },
            ];
            return (
              <div key={cohort.checkpoints.join(" ")} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {cohort.checkpoints.map(formatDay).join(" → ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {integer.format(cohort.phraseCount)} phrase
                    {cohort.phraseCount === 1 ? "" : "s"} ·{" "}
                    <span className="text-green-600 dark:text-green-500">
                      {integer.format(cohort.improved)} up
                    </span>{" "}
                    ·{" "}
                    <span className="text-destructive">
                      {integer.format(cohort.declined)} down
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                  {steps.map((step, index) => (
                    <div key={step.label}>
                      <p className="text-xs text-muted-foreground">
                        {step.label}
                      </p>
                      <p className="font-semibold tabular-nums">
                        {formatMetric("position", step.value)}{" "}
                        {index > 0 ? (
                          <Delta
                            metric="position"
                            current={step.value}
                            previous={steps[index - 1]?.value ?? null}
                          />
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
                <TopList
                  title="Phrases, biggest gain by the last checkpoint first"
                  empty="No phrase was measured at both ends yet."
                  rows={cohort.phrases.slice(0, 4).map((phrase) => {
                    const last =
                      phrase.checkpoints[phrase.checkpoints.length - 1] ?? null;
                    return {
                      key: phrase.id,
                      label: phrase.query,
                      value: (
                        <>
                          {formatMetric("position", phrase.start)} →{" "}
                          {formatMetric("position", last)}{" "}
                          <Delta
                            metric="position"
                            current={last}
                            previous={phrase.start}
                          />
                        </>
                      ),
                    };
                  })}
                />
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}
