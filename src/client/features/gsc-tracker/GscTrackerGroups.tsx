import { useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { GroupFormDialog } from "@/client/features/gsc-tracker/GscTrackerGroupDialog";
import { GroupsTable } from "@/client/features/gsc-tracker/GscTrackerGroupsTable";
import { PageDetailDialog } from "@/client/features/gsc-tracker/GscTrackerPageDetail";
import { PageTable } from "@/client/features/gsc-tracker/GscTrackerPageTable";
import {
  StatTiles,
  TrendChart,
} from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  groupRuleText,
  kindLabel,
  refreshGroups,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import {
  formatDay,
  integer,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteGscTrackerGroup,
  getGscTrackerGroup,
  listGscTrackerGroups,
  refreshGscTrackerGroup,
} from "@/serverFunctions/gscTrackerGroups";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";

/**
 * Page groups: sets of URLs (hand-picked, a sitemap, a directory or a regex)
 * with their totals for the period, and every page of the site below. A
 * group opens with its own totals, daily chart and URLs.
 */
export function PageGroupsTab({
  projectId,
  days,
  canManage,
  groupId,
  onGroupChange,
  onSelectQuery,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  canManage: boolean;
  groupId: string | undefined;
  onGroupChange: (groupId: string | undefined) => void;
  onSelectQuery: (query: string) => void;
}) {
  const siteId = useSiteId();
  const [creating, setCreating] = useState(false);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const groups = useQuery({
    queryKey: ["gscTrackerGroups", siteId, days],
    queryFn: () => listGscTrackerGroups({ data: { projectId, siteId, days } }),
    placeholderData: keepPreviousData,
  });
  const groupOptions = (groups.data?.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
  }));
  const pageTable = (
    <PageTable
      key={groupId ?? "all"}
      projectId={projectId}
      days={days}
      groupId={groupId}
      groups={groupOptions}
      canManage={canManage}
      onSelect={setOpenUrl}
      onGroupCreated={onGroupChange}
    />
  );
  return (
    <div className="space-y-4">
      {groups.data && groups.data.progress < 1 ? (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          Page history: {Math.round(groups.data.progress * 100)}% of 16 months
          stored
          {groups.data.pagesOldestDate
            ? ` (from ${formatDay(groups.data.pagesOldestDate)})`
            : ""}
          . Older days keep arriving with each sync.
        </p>
      ) : null}
      {groupId ? (
        <GroupView
          projectId={projectId}
          days={days}
          groupId={groupId}
          canManage={canManage}
          onBack={() => onGroupChange(undefined)}
        >
          {pageTable}
        </GroupView>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Page groups</h2>
              {canManage ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus data-icon="inline-start" />
                  New group
                </Button>
              ) : null}
            </div>
            {groups.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : groups.isError ? (
              <QueryError
                error={groups.error}
                fallback="Couldn't load the groups."
                onRetry={() => void groups.refetch()}
                isRetrying={groups.isFetching}
              />
            ) : groups.data.groups.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={FolderTree}
                title="No page groups yet"
                description="Group pages by a sitemap, a directory or a regex, or pick them below, to follow their totals together."
              />
            ) : (
              <GroupsTable groups={groups.data.groups} onOpen={onGroupChange} />
            )}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">All pages</h2>
            {pageTable}
          </section>
        </>
      )}
      {creating ? (
        <GroupFormDialog
          projectId={projectId}
          onSaved={(id) => {
            setCreating(false);
            onGroupChange(id);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {openUrl ? (
        <PageDetailDialog
          projectId={projectId}
          url={openUrl}
          days={days}
          onSelectQuery={(query) => {
            setOpenUrl(null);
            onSelectQuery(query);
          }}
          onClose={() => setOpenUrl(null)}
        />
      ) : null}
    </div>
  );
}

function GroupView({
  projectId,
  days,
  groupId,
  canManage,
  onBack,
  children,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  groupId: string;
  canManage: boolean;
  onBack: () => void;
  children: React.ReactNode;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const group = useQuery({
    queryKey: ["gscTrackerGroup", siteId, groupId, days],
    queryFn: () =>
      getGscTrackerGroup({ data: { projectId, siteId, groupId, days } }),
    placeholderData: keepPreviousData,
  });
  const refresh = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      refreshGscTrackerGroup({ data: { projectId, siteId, groupId } }),
    onSuccess: () => {
      toast.success("Sitemap read again");
      refreshGroups(queryClient, siteId);
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () =>
      deleteGscTrackerGroup({ data: { projectId, siteId, groupId } }),
    onSuccess: () => {
      toast.success("Group deleted");
      refreshGroups(queryClient, siteId);
      onBack();
    },
  });
  const back = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft data-icon="inline-start" />
      All groups
    </Button>
  );
  if (group.isPending) return <Skeleton className="h-80 w-full" />;
  if (group.isError)
    return (
      <div className="space-y-2">
        {back}
        <QueryError
          error={group.error}
          fallback="Couldn't load this group."
          onRetry={() => void group.refetch()}
          isRetrying={group.isFetching}
        />
      </div>
    );
  const data = group.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          {back}
          <div className="flex items-center gap-2 px-2">
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <Badge variant="secondary">{kindLabel(data.kind)}</Badge>
            <span className="text-sm text-muted-foreground">
              {integer.format(data.urls)} URL{data.urls === 1 ? "" : "s"}
            </span>
          </div>
          <p className="px-2 text-xs break-all text-muted-foreground">
            {groupRuleText(data)}
            {data.kind === "sitemap" && data.lastRefreshedAt
              ? ` · read ${new Date(data.lastRefreshedAt).toLocaleString("en-US")}`
              : ""}
          </p>
          {data.lastError ? (
            <p className="px-2 text-xs text-destructive">{data.lastError}</p>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            {data.kind === "sitemap" ? (
              <Button
                variant="outline"
                size="sm"
                pending={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <RefreshCw data-icon="inline-start" />
                Read sitemap now
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleting(true)}
            >
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          </div>
        ) : null}
      </div>
      {data.totals && data.range ? (
        <>
          <StatTiles {...data.totals} />
          <TrendChart series={data.series} />
          <p className="text-xs text-muted-foreground">
            {formatDay(data.range.currentStart)} –{" "}
            {formatDay(data.range.currentEnd)}, compared with{" "}
            {formatDay(data.range.previousStart)} –{" "}
            {formatDay(data.range.previousEnd)}. Totals add up the group&apos;s
            pages, anonymized queries included.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No Search Console data for this group&apos;s URLs in the period.
        </p>
      )}
      {children}
      {editing ? (
        <GroupFormDialog
          projectId={projectId}
          group={data}
          onSaved={() => setEditing(false)}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${data.name}?`}
          confirmLabel="Delete group"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        >
          The group and its list of URLs go; the pages&apos; Search Console
          history stays.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
