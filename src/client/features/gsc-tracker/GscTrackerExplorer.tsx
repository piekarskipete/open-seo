import { useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Spinner } from "@/client/components/ui/spinner";
import { CompareTable } from "@/client/features/gsc-tracker/GscTrackerCompareTable";
import {
  applyListFilter,
  defaultSort,
  LIST_FILTERS,
  nextSort,
  sortRows,
  type ListFilter,
  type SortState,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getGscTrackerList } from "@/serverFunctions/gscTracker";
import type {
  GscTrackerRangeDays,
  GscTrackerSortKey,
} from "@/shared/gsc-tracker";

/**
 * Every query with its clicks, impressions, CTR and position against the
 * previous period. A URL filter narrows it to the queries a page earns, with
 * that page's numbers. Opening a query lists the pages it reaches, each of
 * which can be added to the tracker as the query's target.
 */
export function ExplorerTab({
  projectId,
  days,
  defaultSortKey,
  onSelect,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  /** The project's default order for the "All" view (Settings). */
  defaultSortKey: GscTrackerSortKey;
  onSelect: (query: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  // A clicked header wins; until then "All" uses the project default and
  // the other views keep their own order (biggest gain first, and so on).
  const [chosenSort, setChosenSort] = useState<SortState | null>(null);
  const sort =
    chosenSort ?? (filter === "all" ? defaultSort(defaultSortKey) : null);
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter queries"
          aria-label="Filter queries"
          className="h-8 max-w-xs"
        />
        <Input
          value={page}
          onChange={(event) => setPage(event.target.value)}
          placeholder="Filter by URL, e.g. /running-shoes/"
          aria-label="Filter by URL"
          className="h-8 max-w-sm"
        />
        {list.isFetching && !list.isPending ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null}
        <div className="ml-auto">
          <SegmentedToggle
            showLabels
            value={filter}
            onChange={setFilter}
            items={LIST_FILTERS.map((item) => ({ ...item, icon: null }))}
          />
        </div>
      </div>
      {deferredPage ? (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Queries for pages whose URL contains “{deferredPage}”, with those
          pages&apos; numbers.
        </p>
      ) : null}
      {list.isPending ? (
        <div className="p-4">
          <Skeleton className="h-80 w-full" />
        </div>
      ) : list.isError ? (
        <div className="p-4">
          <QueryError
            error={list.error}
            fallback="Couldn't load the queries."
            onRetry={() => void list.refetch()}
            isRetrying={list.isFetching}
          />
        </div>
      ) : list.data ? (
        <CompareTable
          key={`${filter}-${deferredSearch}-${deferredPage}-${sort?.key}-${sort?.dir}`}
          rows={
            sort
              ? sortRows(applyListFilter(list.data.rows, filter), sort)
              : applyListFilter(list.data.rows, filter)
          }
          keyLabel="Query"
          onSelect={onSelect}
          sort={sort}
          onSort={(key) => setChosenSort(nextSort(sort, key))}
        />
      ) : null}
    </div>
  );
}
