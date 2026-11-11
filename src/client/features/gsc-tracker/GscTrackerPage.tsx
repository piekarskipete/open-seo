import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { History } from "lucide-react";
import {
  HistoryNotice,
  TrackerStatus,
} from "@/client/features/gsc-tracker/GscTrackerSetup";
import { CannibalizationTab } from "@/client/features/gsc-tracker/GscTrackerCannibalization";
import { QueryDetailDialog } from "@/client/features/gsc-tracker/GscTrackerParts";
import { KeywordsTab } from "@/client/features/gsc-tracker/GscTrackerKeywords";
import { ExplorerTab } from "@/client/features/gsc-tracker/GscTrackerExplorer";
import { PageGroupsTab } from "@/client/features/gsc-tracker/GscTrackerGroups";
import { OverviewBoard } from "@/client/features/gsc-tracker/GscTrackerOverviewBoard";
import {
  DateFormatContext,
  PositionFormatContext,
  SiteContext,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getGscTrackerStatus } from "@/serverFunctions/gscTracker";
import {
  GSC_TRACKER_TABS,
  type GscTrackerRangeDays,
  type GscTrackerSortKey,
  type GscTrackerTab,
  type GscTrackerWidget,
} from "@/shared/gsc-tracker";

const RANGES: { days: GscTrackerRangeDays; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "12 months" },
  { days: 480, label: "16 months" },
];

/** A change to the site page's search params. */
type TrackerUpdate = {
  tab?: GscTrackerTab;
  days?: GscTrackerRangeDays;
  group?: string | undefined;
};

const TAB_LABELS: Record<GscTrackerTab, string> = {
  overview: "Overview",
  keywords: "Keywords",
  explorer: "Query Explorer",
  pages: "Page Groups",
  cannibalization: "Cannibalization",
};

/** What each tab is for, shown under the tabs. */
const TAB_HINTS: Record<GscTrackerTab, string> = {
  overview:
    "Your summaries in one place. Customize which ones you see and in what order.",
  keywords:
    "Phrases you follow day by day, each on the URL that should rank for it.",
  explorer:
    "Every query Search Console reports, against the previous period. Add any of them to Keywords.",
  pages:
    "Every page, and your page groups: a sitemap, a directory, a regex or your own list.",
  cannibalization: "Queries split between two or more of your pages.",
};

/** One tracked site: its status, then the report tabs. */
export function GscTrackerSitePage({
  projectId,
  siteId,
  tab,
  days,
  groupId,
  onChange,
}: {
  projectId: string;
  siteId: string;
  tab: GscTrackerTab;
  days: GscTrackerRangeDays;
  groupId: string | undefined;
  onChange: (update: TrackerUpdate) => void;
}) {
  const status = useQuery({
    queryKey: ["gscTrackerStatus", siteId],
    queryFn: () => getGscTrackerStatus({ data: { projectId, siteId } }),
    // While the history is still loading, follow the cron's progress.
    refetchInterval: (query) =>
      query.state.data && query.state.data.progress < 1 ? 30_000 : false,
  });

  if (status.isPending) return <Skeleton className="h-40 w-full" />;
  if (status.isError)
    return (
      <QueryError
        error={status.error}
        fallback="Couldn't load this site."
        onRetry={() => void status.refetch()}
        isRetrying={status.isFetching}
      />
    );
  if (!status.data.available)
    return (
      <EmptyState
        icon={History}
        title="GSC Tracker runs on self-hosted OpenSEO"
        description="It stores your Search Console history in your own database. Use GSC Insights for live Search Console data."
      />
    );
  return (
    <SiteContext.Provider value={siteId}>
      <div className="space-y-4">
        <TrackerStatus projectId={projectId} status={status.data} />
        {status.data.newestDate ? (
          <PositionFormatContext.Provider value={status.data.positionFormat}>
            <DateFormatContext.Provider value={status.data.dateFormat}>
              <TrackerReport
                projectId={projectId}
                canManage={status.data.canManage}
                explorerSort={status.data.explorerSort}
                overviewLayout={status.data.overviewLayout}
                history={{
                  oldestDate: status.data.oldestDate,
                  newestDate: status.data.newestDate,
                  progress: status.data.progress,
                }}
                tab={tab}
                days={days}
                groupId={groupId}
                onChange={onChange}
              />
            </DateFormatContext.Provider>
          </PositionFormatContext.Provider>
        ) : (
          <EmptyState
            icon={History}
            title="Fetching the first days"
            description="The most recent days arrive first, then older history in the background."
          />
        )}
      </div>
    </SiteContext.Provider>
  );
}

function TrackerReport({
  projectId,
  canManage,
  explorerSort,
  overviewLayout,
  history,
  tab,
  days,
  groupId,
  onChange,
}: {
  projectId: string;
  canManage: boolean;
  explorerSort: GscTrackerSortKey;
  overviewLayout: GscTrackerWidget[];
  /** The stored history, to flag periods that reach past it. */
  history: { oldestDate: string | null; newestDate: string; progress: number };
  tab: GscTrackerTab;
  days: GscTrackerRangeDays;
  groupId: string | undefined;
  onChange: (update: TrackerUpdate) => void;
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
      <p className="-mt-2 text-xs text-muted-foreground">{TAB_HINTS[tab]}</p>
      {tab === "keywords" ? null : <HistoryNotice {...history} days={days} />}
      {tab === "keywords" ? (
        <KeywordsTab projectId={projectId} canManage={canManage} />
      ) : tab === "overview" ? (
        <OverviewBoard
          projectId={projectId}
          days={days}
          canManage={canManage}
          layout={overviewLayout}
          onOpen={(next, group) => onChange({ tab: next, group })}
        />
      ) : tab === "pages" ? (
        <PageGroupsTab
          projectId={projectId}
          days={days}
          canManage={canManage}
          groupId={groupId}
          onGroupChange={(group) => onChange({ group })}
          onSelectQuery={setSelectedQuery}
        />
      ) : tab === "cannibalization" ? (
        <CannibalizationTab
          projectId={projectId}
          days={days}
          canManage={canManage}
          onSelect={setSelectedQuery}
        />
      ) : (
        <ExplorerTab
          projectId={projectId}
          days={days}
          defaultSortKey={explorerSort}
          onSelect={setSelectedQuery}
          canManage={canManage}
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
