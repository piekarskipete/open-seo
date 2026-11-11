import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Skeleton } from "@/client/components/ui/skeleton";
import { CompareTable } from "@/client/features/gsc-tracker/GscTrackerCompareTable";
import {
  StatTiles,
  TrendChart,
} from "@/client/features/gsc-tracker/GscTrackerParts";
import { RangePicker } from "@/client/features/gsc-tracker/GscTrackerRangePicker";
import {
  initialRange,
  rangeRequest,
  type ChartRange,
} from "@/client/features/gsc-tracker/gscTrackerRange";
import {
  applyListFilter,
  formatDay,
  LIST_FILTERS,
  type ListFilter,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getGscTrackerPageDetail } from "@/serverFunctions/gscTrackerGroups";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

/** One page: its totals and daily numbers, and every query it earns. */
export function PageDetailDialog({
  projectId,
  url,
  days,
  onSelectQuery,
  onClose,
}: {
  projectId: string;
  url: string;
  days: GscTrackerRangeDays;
  onSelectQuery?: (query: string) => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const [range, setRange] = useState<ChartRange>(() => initialRange(days));
  const [view, setView] = useState<ListFilter>("all");
  const request = rangeRequest(range);
  const detail = useQuery({
    queryKey: ["gscTrackerPageDetail", siteId, url, request],
    queryFn: () =>
      getGscTrackerPageDetail({ data: { projectId, siteId, url, ...request } }),
    enabled: request !== null,
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-all">
            {url}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Open the page"
            >
              <ExternalLink className="size-4" />
            </a>
          </DialogTitle>
          <DialogDescription>
            The page&apos;s daily numbers, and every query it earned, against
            the period before.
          </DialogDescription>
        </DialogHeader>
        <RangePicker value={range} onChange={setRange} />
        {detail.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : detail.isError ? (
          <QueryError
            error={detail.error}
            fallback="Couldn't load this page."
            onRetry={() => void detail.refetch()}
            isRetrying={detail.isFetching}
          />
        ) : detail.data ? (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            <StatTiles {...detail.data.totals} />
            <TrendChart series={detail.data.series} />
            <p className="text-xs text-muted-foreground">
              {formatDay(detail.data.currentStart)} –{" "}
              {formatDay(detail.data.currentEnd)}, compared with{" "}
              {formatDay(detail.data.previousStart)} –{" "}
              {formatDay(detail.data.previousEnd)}. Page totals include
              anonymized queries; the query list doesn&apos;t.
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                <p className="text-sm font-semibold">
                  Queries ({detail.data.queries.length})
                </p>
                <SegmentedToggle
                  showLabels
                  value={view}
                  onChange={setView}
                  items={LIST_FILTERS.map((item) => ({ ...item, icon: null }))}
                />
              </div>
              <CompareTable
                key={view}
                rows={applyListFilter(detail.data.queries, view)}
                keyLabel="Query"
                onSelect={onSelectQuery}
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
