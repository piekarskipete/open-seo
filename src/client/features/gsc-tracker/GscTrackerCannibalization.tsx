import { useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Spinner } from "@/client/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  useFormatMetric,
  useSiteId,
  type Metrics,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { ExclusionsBar } from "@/client/features/gsc-tracker/GscTrackerExclusions";
import { getGscTrackerCannibalization } from "@/serverFunctions/gscTracker";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

type CannibalQuery = {
  query: string;
  impressions: number;
  clicks: number;
  pages: (Metrics & { url: string; share: number })[];
};

/** Queries split between pages, searchable by query and by page URL. */
export function CannibalizationTab({
  projectId,
  days,
  canManage,
  onSelect,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  canManage: boolean;
  onSelect: (query: string) => void;
}) {
  const siteId = useSiteId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const deferredPage = useDeferredValue(page.trim());
  const result = useQuery({
    queryKey: [
      "gscTrackerCannibalization",
      siteId,
      days,
      deferredSearch,
      deferredPage,
    ],
    queryFn: () =>
      getGscTrackerCannibalization({
        data: {
          projectId,
          siteId,
          days,
          search: deferredSearch || undefined,
          page: deferredPage || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Queries where a second page of yours earns at least 10% of the
        impressions. Pick one page per query, or give each page a distinct
        intent.
      </p>
      <div className="flex flex-wrap items-center gap-2">
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
          placeholder="Filter by URL, e.g. /blog/"
          aria-label="Filter by URL"
          className="h-8 max-w-sm"
        />
        {result.isFetching && !result.isPending ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null}
        {result.data ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {result.data.queries.length} quer
            {result.data.queries.length === 1 ? "y" : "ies"}
          </span>
        ) : null}
      </div>
      {result.data ? (
        <ExclusionsBar
          projectId={projectId}
          exclusions={result.data.exclusions}
          canManage={canManage}
        />
      ) : null}
      {result.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : result.isError ? (
        <QueryError
          error={result.error}
          fallback="Couldn't check for competing pages."
          onRetry={() => void result.refetch()}
          isRetrying={result.isFetching}
        />
      ) : result.data ? (
        <CannibalizationList
          queries={result.data.queries}
          filtered={Boolean(deferredSearch || deferredPage)}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

function CannibalizationList({
  queries,
  filtered,
  onSelect,
}: {
  queries: CannibalQuery[];
  filtered: boolean;
  onSelect: (query: string) => void;
}) {
  const formatMetric = useFormatMetric();
  if (queries.length === 0)
    return (
      <EmptyState
        title="No competing pages found"
        description={
          filtered
            ? "No query matching these filters splits its impressions between your pages."
            : "No query in this period splits its impressions between two or more of your pages."
        }
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
