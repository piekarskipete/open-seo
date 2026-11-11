import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Globe, History, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AddSiteDialog } from "@/client/features/gsc-tracker/GscTrackerAddSite";
import {
  formatDay,
  formatMetric,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  getGscTrackerSites,
  stopGscTracker,
} from "@/serverFunctions/gscTracker";

type Sites = Awaited<ReturnType<typeof getGscTrackerSites>>;
type Site = Sites["sites"][number];

/** The project's tracked Search Console properties, like Rank Tracking's
 *  tracked domains: one row per site, opening its report. */
export function GscTrackerSiteList({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Site | null>(null);
  const sites = useQuery({
    queryKey: ["gscTrackerSites", projectId],
    queryFn: () => getGscTrackerSites({ data: { projectId } }),
    // While a history is still loading, follow the cron's progress.
    refetchInterval: (query) =>
      query.state.data?.sites.some((site) => site.progress < 1)
        ? 30_000
        : false,
  });
  const remove = useMutation({
    mutationFn: (siteId: string) =>
      stopGscTracker({ data: { projectId, siteId } }),
    onSuccess: () => {
      setRemoving(null);
      toast.success("Site removed and its history deleted");
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerSites", projectId],
      });
    },
  });

  if (sites.data && !sites.data.available)
    return (
      <EmptyState
        icon={History}
        title="GSC Tracker runs on self-hosted OpenSEO"
        description="It stores your Search Console history in your own database. Use GSC Insights for live Search Console data."
      />
    );
  const canManage = sites.data?.canManage ?? false;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-5 pt-4 pb-3">
        <CardTitle>
          <h2 className="text-sm font-semibold">Tracked Sites</h2>
        </CardTitle>
        {canManage ? (
          <CardAction className="self-center">
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              Add Site
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <div className="divide-y divide-border border-t border-border">
        {sites.isError ? (
          <div className="px-5 py-4">
            <QueryError
              error={sites.error}
              fallback="Failed to load tracked sites"
              onRetry={() => void sites.refetch()}
              isRetrying={sites.isFetching}
            />
          </div>
        ) : null}
        {sites.isPending ? (
          <div className="space-y-4 px-5 py-4" aria-busy>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
            ))}
          </div>
        ) : !sites.data ? null : sites.data.sites.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={Globe}
            title="No tracked sites yet"
            description="Add a Search Console property to keep its history and follow phrases day by day."
          />
        ) : (
          sites.data.sites.map((site) => (
            <SiteRow
              key={site.id}
              projectId={projectId}
              site={site}
              canManage={canManage}
              onRemove={() => setRemoving(site)}
            />
          ))
        )}
      </div>
      {adding ? (
        <AddSiteDialog
          projectId={projectId}
          projectSiteUrl={sites.data?.projectSiteUrl ?? null}
          trackedSiteUrls={(sites.data?.sites ?? []).map(
            (site) => site.siteUrl,
          )}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${removing.siteUrl}?`}
          confirmLabel="Remove and delete history"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        >
          This deletes the stored Search Console history, followed phrases and
          tags of this site. Search Console itself is not affected.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

const integer = new Intl.NumberFormat("en-US");

function SiteRow({
  projectId,
  site,
  canManage,
  onRemove,
}: {
  projectId: string;
  site: Site;
  canManage: boolean;
  onRemove: () => void;
}) {
  const details = [
    site.usesProjectConnection
      ? "Project connection"
      : (site.accountEmail ?? "Google account"),
    site.oldestDate && site.newestDate
      ? `${formatDay(site.oldestDate)} – ${formatDay(site.newestDate)}`
      : "Fetching the first days",
    site.progress < 1
      ? `Loading history ${Math.round(site.progress * 100)}%`
      : null,
    site.lastSyncedAt
      ? `Last: ${new Date(site.lastSyncedAt).toLocaleDateString()}`
      : null,
  ].filter(Boolean);
  return (
    <div className="relative flex w-full items-center gap-4 px-5 py-3.5 transition-colors hover:bg-foreground/[0.03]">
      <Link
        to="/p/$projectId/gsc-tracker/$siteId"
        params={{ projectId, siteId: site.id }}
        search={{ tab: "overview", days: 28 }}
        className="absolute inset-0 z-0"
        aria-label={`Open ${site.siteUrl}`}
      />
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="truncate font-medium">{site.siteUrl}</p>
        <p className="text-xs text-muted-foreground">{details.join(" · ")}</p>
        {site.lastError ? (
          <p className="text-xs text-destructive">{site.lastError}</p>
        ) : null}
      </div>
      <div className="pointer-events-none hidden items-center gap-6 text-sm sm:flex">
        <Stat label="Phrases" value={integer.format(site.phrases)} />
        <Stat
          label="Clicks 28d"
          value={formatMetric("clicks", site.current?.clicks ?? null)}
        />
        <Stat
          label="Position"
          value={formatMetric("position", site.current?.position ?? null)}
        />
      </div>
      {canManage ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="relative z-10 text-muted-foreground hover:text-destructive"
          title="Remove site"
          aria-label={`Remove ${site.siteUrl}`}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onRemove();
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
      <ChevronRight className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-mono font-medium">{value}</p>
    </div>
  );
}
