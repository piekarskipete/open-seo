import { useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { CompareTable } from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  applyListFilter,
  LIST_FILTERS,
  type ListFilter,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getGscTrackerList } from "@/serverFunctions/gscTracker";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

/**
 * Every query with its clicks, impressions, CTR and position against the
 * previous period. A URL filter narrows it to the queries a page earns, with
 * that page's numbers. Opening a query lists the pages it reaches, each of
 * which can be added to the tracker as the query's target.
 */
export function ExplorerTab({
  projectId,
  days,
  onSelect,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  onSelect: (query: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const deferredSearch = useDeferredValue(search.trim());
  const deferredPage = useDeferredValue(page.trim());
  const list = useQuery({
    queryKey: ["gscTrackerList", projectId, days, deferredSearch, deferredPage],
    queryFn: () =>
      getGscTrackerList({
        data: {
          projectId,
          days,
          search: deferredSearch || undefined,
          page: deferredPage || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter queries"
            aria-label="Filter queries"
            className="max-w-xs"
          />
          <Input
            value={page}
            onChange={(event) => setPage(event.target.value)}
            placeholder="Filter by URL, e.g. /running-shoes/"
            aria-label="Filter by URL"
            className="max-w-sm"
          />
        </div>
        <SegmentedToggle
          showLabels
          value={filter}
          onChange={setFilter}
          items={LIST_FILTERS.map((item) => ({ ...item, icon: null }))}
        />
      </div>
      {deferredPage ? (
        <p className="text-xs text-muted-foreground">
          Queries for pages whose URL contains “{deferredPage}”, with those
          pages&apos; numbers.
        </p>
      ) : null}
      {list.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : list.isError ? (
        <QueryError
          error={list.error}
          fallback="Couldn't load the queries."
          onRetry={() => void list.refetch()}
          isRetrying={list.isFetching}
        />
      ) : list.data ? (
        <CompareTable
          key={`${filter}-${deferredSearch}-${deferredPage}`}
          rows={applyListFilter(list.data.rows, filter)}
          keyLabel="Query"
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}
