import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { PageHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { History } from "lucide-react";
import {
  HistoryNotice,
  StartTracking,
  TrackerStatus,
} from "@/client/features/gsc-tracker/GscTrackerSetup";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { CannibalizationList } from "@/client/features/gsc-tracker/GscTrackerCannibalization";
import {
  QueryDetailDialog,
  StatTiles,
  TrendChart,
} from "@/client/features/gsc-tracker/GscTrackerParts";
import { KeywordsTab } from "@/client/features/gsc-tracker/GscTrackerKeywords";
import { ExplorerTab } from "@/client/features/gsc-tracker/GscTrackerExplorer";
import {
  formatDay,
  PositionFormatContext,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  getGscTrackerCannibalization,
  getGscTrackerOverview,
  getGscTrackerStatus,
} from "@/serverFunctions/gscTracker";
import {
  GSC_TRACKER_TABS,
  type GscTrackerRangeDays,
  type GscTrackerSortKey,
  type GscTrackerTab,
} from "@/shared/gsc-tracker";

const RANGES: { days: GscTrackerRangeDays; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "12 months" },
  { days: 480, label: "16 months" },
];

const TAB_LABELS: Record<GscTrackerTab, string> = {
  keywords: "Keywords",
  explorer: "Query Explorer",
  overview: "Overview",
  cannibalization: "Cannibalization",
};

export function GscTrackerPage({
  projectId,
  tab,
  days,
  onChange,
}: {
  projectId: string;
  tab: GscTrackerTab;
  days: GscTrackerRangeDays;
  onChange: (update: {
    tab?: GscTrackerTab;
    days?: GscTrackerRangeDays;
  }) => void;
}) {
  const status = useQuery({
    queryKey: ["gscTrackerStatus", projectId],
    queryFn: () => getGscTrackerStatus({ data: { projectId } }),
    // While the history is still loading, follow the cron's progress.
    refetchInterval: (query) =>
      query.state.data?.enabled && query.state.data.progress < 1
        ? 30_000
        : false,
  });

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="GSC Tracker"
          description="Follow phrases day by day on the URL that should rank, and keep up to 16 months of Search Console history."
        />
        {status.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : status.isError ? (
          <QueryError
            error={status.error}
            fallback="Couldn't load the tracker."
            onRetry={() => void status.refetch()}
            isRetrying={status.isFetching}
          />
        ) : !status.data.available ? (
          <EmptyState
            icon={History}
            title="GSC Tracker runs on self-hosted OpenSEO"
            description="It stores your Search Console history in your own database. Use GSC Insights for live Search Console data."
          />
        ) : !status.data.connected ? (
          <GoogleConnectionCard
            provider="gsc"
            projectId={projectId}
            prominent
          />
        ) : !status.data.enabled ? (
          <StartTracking
            projectId={projectId}
            canManage={status.data.canManage}
            siteUrl={status.data.siteUrl}
          />
        ) : (
          <>
            <TrackerStatus projectId={projectId} status={status.data} />
            {status.data.newestDate ? (
              <PositionFormatContext.Provider
                value={status.data.positionFormat}
              >
                <TrackerReport
                  projectId={projectId}
                  canManage={status.data.canManage}
                  explorerSort={status.data.explorerSort}
                  history={{
                    oldestDate: status.data.oldestDate,
                    newestDate: status.data.newestDate,
                    progress: status.data.progress,
                  }}
                  tab={tab}
                  days={days}
                  onChange={onChange}
                />
              </PositionFormatContext.Provider>
            ) : (
              <EmptyState
                icon={History}
                title="Fetching the first days"
                description="The most recent days arrive first, then older history in the background."
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TrackerReport({
  projectId,
  canManage,
  explorerSort,
  history,
  tab,
  days,
  onChange,
}: {
  projectId: string;
  canManage: boolean;
  explorerSort: GscTrackerSortKey;
  /** The stored history, to flag periods that reach past it. */
  history: { oldestDate: string | null; newestDate: string; progress: number };
  tab: GscTrackerTab;
  days: GscTrackerRangeDays;
  onChange: (update: {
    tab?: GscTrackerTab;
    days?: GscTrackerRangeDays;
  }) => void;
}) {
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onValueChange={(value: GscTrackerTab) => onChange({ tab: value })}
        >
          <TabsList>
            {GSC_TRACKER_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* Followed phrases pick a month instead of a window. */}
        {tab === "keywords" ? null : (
          <SegmentedToggle
            showLabels
            value={`${days}`}
            onChange={(value) => {
              const picked = RANGES.find((range) => `${range.days}` === value);
              if (picked) onChange({ days: picked.days });
            }}
            items={RANGES.map((range) => ({
              value: `${range.days}`,
              label: range.label,
              icon: null,
            }))}
          />
        )}
      </div>
      {tab === "keywords" ? null : <HistoryNotice {...history} days={days} />}
      {tab === "keywords" ? (
        <KeywordsTab projectId={projectId} canManage={canManage} />
      ) : tab === "overview" ? (
        <OverviewTab projectId={projectId} days={days} />
      ) : tab === "cannibalization" ? (
        <CannibalizationTab
          projectId={projectId}
          days={days}
          onSelect={setSelectedQuery}
        />
      ) : (
        <ExplorerTab
          projectId={projectId}
          days={days}
          defaultSortKey={explorerSort}
          onSelect={setSelectedQuery}
        />
      )}
      {selectedQuery ? (
        <QueryDetailDialog
          projectId={projectId}
          canManage={canManage}
          query={selectedQuery}
          days={days}
          onClose={() => setSelectedQuery(null)}
        />
      ) : null}
    </div>
  );
}

function OverviewTab({
  projectId,
  days,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
}) {
  const overview = useQuery({
    queryKey: ["gscTrackerOverview", projectId, days],
    queryFn: () => getGscTrackerOverview({ data: { projectId, days } }),
    placeholderData: keepPreviousData,
  });
  if (overview.isPending) return <Skeleton className="h-80 w-full" />;
  if (overview.isError)
    return (
      <QueryError
        error={overview.error}
        fallback="Couldn't load the overview."
        onRetry={() => void overview.refetch()}
        isRetrying={overview.isFetching}
      />
    );
  if (!overview.data) return null;
  return (
    <div className="space-y-4">
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

function CannibalizationTab({
  projectId,
  days,
  onSelect,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  onSelect: (query: string) => void;
}) {
  const result = useQuery({
    queryKey: ["gscTrackerCannibalization", projectId, days],
    queryFn: () => getGscTrackerCannibalization({ data: { projectId, days } }),
    placeholderData: keepPreviousData,
  });
  if (result.isPending) return <Skeleton className="h-80 w-full" />;
  if (result.isError)
    return (
      <QueryError
        error={result.error}
        fallback="Couldn't check for competing pages."
        onRetry={() => void result.refetch()}
        isRetrying={result.isFetching}
      />
    );
  if (!result.data) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Queries where a second page of yours earns at least 10% of the
        impressions. Pick one page per query, or give each page a distinct
        intent.
      </p>
      <CannibalizationList queries={result.data.queries} onSelect={onSelect} />
    </div>
  );
}
