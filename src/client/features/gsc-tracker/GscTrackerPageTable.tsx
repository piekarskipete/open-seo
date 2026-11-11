import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { RowSelectionState } from "@tanstack/react-table";
import {
  FolderPlus,
  FolderMinus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Spinner } from "@/client/components/ui/spinner";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { CompareTable } from "@/client/features/gsc-tracker/GscTrackerCompareTable";
import {
  AddToGroupDialog,
  GroupFormDialog,
} from "@/client/features/gsc-tracker/GscTrackerGroupDialog";
import { PageFilterPanel } from "@/client/features/gsc-tracker/GscTrackerPageFilter";
import {
  activeFilterCount,
  applyPageView,
  EMPTY_PAGE_FILTER,
  PAGE_VIEWS,
  refreshGroups,
  sitemapGroupName,
  type PageFilterValue,
  type PageView,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import {
  nextSort,
  sortRows,
  type SortState,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  listGscTrackerPages,
  removeGscTrackerGroupUrls,
} from "@/serverFunctions/gscTrackerGroups";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

/**
 * Pages with their clicks, impressions, CTR and position against the
 * previous period: every page of the site, or a group's URLs. Selected pages
 * go into a group from the bar at the bottom.
 */
export function PageTable({
  projectId,
  days,
  groupId,
  groups,
  canManage,
  onSelect,
  onGroupCreated,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  /** A group's URLs; without it, every page of the site. */
  groupId?: string;
  /** Groups the selection can be added to. */
  groups: { id: string; name: string }[];
  canManage: boolean;
  onSelect: (url: string) => void;
  /** Opens a group saved from the page list's sitemap filter. */
  onGroupCreated?: (groupId: string) => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<PageFilterValue>(EMPTY_PAGE_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<PageView>("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [adding, setAdding] = useState(false);
  const [savingSitemap, setSavingSitemap] = useState(false);
  const sitemap =
    filter.urlMode === "sitemap" && filter.url ? filter.url : null;
  const pages = useQuery({
    queryKey: ["gscTrackerPages", siteId, groupId ?? null, days, filter],
    queryFn: () =>
      listGscTrackerPages({
        data: {
          projectId,
          siteId,
          days,
          groupId,
          urlMode: filter.urlMode,
          url: filter.url || undefined,
          queries: filter.queries || undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    meta: { errorToast: false },
    mutationFn: (urls: string[]) =>
      removeGscTrackerGroupUrls({
        data: { projectId, siteId, groupId: groupId ?? "", urls },
      }),
    onSuccess: (result) => {
      toast.success(
        `Removed ${result.removed} URL${result.removed === 1 ? "" : "s"} from the group`,
      );
      setSelection({});
      refreshGroups(queryClient, siteId);
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't remove these URLs")),
  });
  const listed = new Set((pages.data?.rows ?? []).map((row) => row.key));
  const selected = Object.keys(selection).filter(
    (key) => selection[key] && listed.has(key),
  );
  const rows = pages.data ? applyPageView(pages.data.rows, view) : [];
  const filters = activeFilterCount(filter);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button
          variant={showFilters ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowFilters((open) => !open)}
        >
          <SlidersHorizontal data-icon="inline-start" />
          Filters
          {filters > 0 ? (
            <Badge size="sm" className="ml-1">
              {filters}
            </Badge>
          ) : null}
        </Button>
        {pages.data ? (
          <span className="text-xs text-muted-foreground">
            {rows.length.toLocaleString("en-US")} URL
            {rows.length === 1 ? "" : "s"}
            {pages.data.truncated ? " (the top 5,000)" : ""}
          </span>
        ) : null}
        {pages.isFetching && !pages.isPending ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null}
        <div className="ml-auto">
          <SegmentedToggle
            showLabels
            value={view}
            onChange={setView}
            items={PAGE_VIEWS.map((item) => ({ ...item, icon: null }))}
          />
        </div>
      </div>
      {showFilters ? (
        <PageFilterPanel value={filter} onApply={setFilter} />
      ) : null}
      {sitemap ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <p className="min-w-0 text-xs break-all text-muted-foreground">
            Every URL listed in {sitemap}, those without Search Console data
            too.
          </p>
          {canManage && !groupId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSavingSitemap(true)}
            >
              <RefreshCw data-icon="inline-start" />
              Save as synced group
            </Button>
          ) : null}
        </div>
      ) : null}
      {pages.isPending ? (
        <div className="p-4">
          <Skeleton className="h-80 w-full" />
        </div>
      ) : pages.isError ? (
        <div className="p-4">
          <QueryError
            error={pages.error}
            fallback="Couldn't load the pages."
            onRetry={() => void pages.refetch()}
            isRetrying={pages.isFetching}
          />
        </div>
      ) : pages.data ? (
        <CompareTable
          key={`${view}-${JSON.stringify(filter)}-${sort?.key}-${sort?.dir}`}
          rows={sort ? sortRows(rows, sort) : rows}
          keyLabel="URL"
          onSelect={onSelect}
          sort={sort}
          onSort={(key) => setSort(nextSort(sort, key))}
          selection={canManage ? selection : undefined}
          onSelectionChange={setSelection}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          Page history is still on its way; the first days arrive with the next
          sync.
        </p>
      )}
      {canManage ? (
        <TableBulkActionBar
          selectedCount={selected.length}
          selectedLabel={selected.length === 1 ? "URL" : "URLs"}
          onClear={() => setSelection({})}
          actions={
            <div className="flex items-center gap-0.5 px-1.5">
              <TableBulkActionButton
                icon={<FolderPlus className="size-3.5" />}
                onClick={() => setAdding(true)}
              >
                Add to group
              </TableBulkActionButton>
              {groupId ? (
                <TableBulkActionButton
                  icon={<FolderMinus className="size-3.5" />}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(selected)}
                >
                  Remove from group
                </TableBulkActionButton>
              ) : null}
            </div>
          }
        />
      ) : null}
      {savingSitemap && sitemap ? (
        <GroupFormDialog
          projectId={projectId}
          initial={{
            name: sitemapGroupName(sitemap),
            kind: "sitemap",
            pattern: sitemap,
          }}
          onSaved={(id) => {
            setSavingSitemap(false);
            onGroupCreated?.(id);
          }}
          onClose={() => setSavingSitemap(false)}
        />
      ) : null}
      {adding ? (
        <AddToGroupDialog
          projectId={projectId}
          urls={selected}
          groups={groups.filter((group) => group.id !== groupId)}
          onDone={() => {
            setAdding(false);
            setSelection({});
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
