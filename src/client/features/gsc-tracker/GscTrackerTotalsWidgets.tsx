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
