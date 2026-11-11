import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  formatDay,
  shiftDay,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { RankLinkSettings } from "@/client/features/gsc-tracker/GscTrackerRankSettings";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  updateGscTrackerSettings,
  stopGscTracker,
  syncGscTracker,
  type getGscTrackerStatus,
} from "@/serverFunctions/gscTracker";
import type {
  GscTrackerDateFormat,
  GscTrackerPositionFormat,
  GscTrackerSortKey,
} from "@/shared/gsc-tracker";

// A tracked site's sync status, settings, and removal.

type Status = Awaited<ReturnType<typeof getGscTrackerStatus>>;

export function TrackerStatus({
  projectId,
  status,
}: {
  projectId: string;
  status: Status;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const siteId = status.id;
  const [confirmStop, setConfirmStop] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("gscTracker") &&
        query.queryKey[1] === siteId,
    });
  const sync = useMutation({
    mutationFn: () => syncGscTracker({ data: { projectId, siteId } }),
    onSuccess: () => void refresh(),
  });
  const stop = useMutation({
    mutationFn: () => stopGscTracker({ data: { projectId, siteId } }),
    onSuccess: () => {
      toast.success("Site removed and its history deleted");
      setConfirmStop(false);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerSites", projectId],
      });
      void navigate({
        to: "/p/$projectId/gsc-tracker",
        params: { projectId },
      });
    },
  });

  const loading = status.progress < 1;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
        <div className="space-y-0.5">
          <div>
            <span className="font-medium">{status.siteUrl}</span>
            {status.oldestDate && status.newestDate ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatDay(status.oldestDate)} –{" "}
                {formatDay(status.newestDate)}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {loading
              ? `Loading history: ${Math.round(status.progress * 100)}% of 16 months. Older days keep arriving every few minutes.`
              : "All 16 months loaded."}
            {status.lastSyncedAt
              ? ` Last refreshed ${new Date(status.lastSyncedAt).toLocaleString("en-US")}.`
              : null}
          </div>
        </div>
        {status.canManage ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sync.mutate()}
              pending={sync.isPending}
            >
              <RefreshCw className="size-3.5" />
              Sync now
            </Button>
            <TrackerSettings
              projectId={projectId}
              siteId={siteId}
              positionFormat={status.positionFormat}
              explorerSort={status.explorerSort}
              dateFormat={status.dateFormat}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmStop(true)}
            >
              Remove site
            </Button>
          </div>
        ) : null}
      </div>
      {status.lastError ? (
        <Alert variant="warning">
          <AlertDescription>{status.lastError}</AlertDescription>
        </Alert>
      ) : null}
      {confirmStop ? (
        <ConfirmDialog
          title={`Remove ${status.siteUrl}?`}
          confirmLabel="Remove and delete history"
          destructive
          pending={stop.isPending}
          onConfirm={() => stop.mutate()}
          onClose={() => setConfirmStop(false)}
        >
          This deletes the stored Search Console history, followed phrases and
          tags of this site. Search Console itself is not affected, and you can
          add the site again later.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

const POSITION_FORMATS: {
  value: GscTrackerPositionFormat;
  label: string;
}[] = [
  { value: "decimal", label: "7.4" },
  { value: "whole", label: "7" },
];

const SORT_KEYS: { value: GscTrackerSortKey; label: string }[] = [
  { value: "clicks", label: "Clicks" },
  { value: "impressions", label: "Impr." },
  { value: "ctr", label: "CTR" },
  { value: "position", label: "Position" },
  { value: "urls", label: "URLs" },
];

const DATE_FORMATS: { value: GscTrackerDateFormat; label: string }[] = [
  { value: "dd.mm", label: "03.10" },
  { value: "mon-d", label: "Oct 3" },
];

type Settings = {
  positionFormat?: GscTrackerPositionFormat;
  explorerSort?: GscTrackerSortKey;
  dateFormat?: GscTrackerDateFormat;
};

/** Project-wide display settings for the tracker. */
function TrackerSettings({
  projectId,
  siteId,
  positionFormat,
  explorerSort,
  dateFormat,
}: {
  projectId: string;
  siteId: string;
  positionFormat: GscTrackerPositionFormat;
  explorerSort: GscTrackerSortKey;
  dateFormat: GscTrackerDateFormat;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (settings: Settings) =>
      updateGscTrackerSettings({ data: { projectId, siteId, ...settings } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerStatus", siteId],
      }),
  });
  // Show a choice right away while it saves.
  const pending = save.isPending ? save.variables : undefined;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Tracker settings" />
        }
      >
        <Settings className="size-3.5" />
        Settings
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Tracker settings</PopoverTitle>
          <PopoverDescription>
            Applies to everyone viewing this project.
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Position format</span>
            <SegmentedToggle
              showLabels
              value={pending?.positionFormat ?? positionFormat}
              onChange={(value) => save.mutate({ positionFormat: value })}
              items={POSITION_FORMATS.map((item) => ({
                ...item,
                icon: null,
              }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            7.4 shows Search Console&apos;s average position; 7 rounds it to a
            whole place.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Day format</span>
          <SegmentedToggle
            showLabels
            value={pending?.dateFormat ?? dateFormat}
            onChange={(value) => save.mutate({ dateFormat: value })}
            items={DATE_FORMATS.map((item) => ({ ...item, icon: null }))}
          />
        </div>
        <RankLinkSettings projectId={projectId} />
        <div className="space-y-1">
          <div className="text-sm">Query Explorer default sort</div>
          <SegmentedToggle
            showLabels
            value={pending?.explorerSort ?? explorerSort}
            onChange={(value) => save.mutate({ explorerSort: value })}
            items={SORT_KEYS.map((item) => ({ ...item, icon: null }))}
          />
          <p className="text-xs text-muted-foreground">
            How the &ldquo;All&rdquo; view opens: most clicks, impressions, CTR
            or URLs first, or best position first. Column headers still re-sort.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Says when the chosen period reaches past the stored history, so a longer
 * period showing the same numbers doesn't read as a broken filter.
 */
export function HistoryNotice({
  oldestDate,
  newestDate,
  progress,
  days,
}: {
  oldestDate: string | null;
  newestDate: string;
  progress: number;
  days: number;
}) {
  if (!oldestDate) return null;
  const currentStart = shiftDay(newestDate, -(days - 1));
  const previousStart = shiftDay(currentStart, -days);
  if (previousStart >= oldestDate) return null;
  const stored = `${formatDay(oldestDate)} – ${formatDay(newestDate)}`;
  const loading =
    progress < 1
      ? ` Older days keep loading (${Math.round(progress * 100)}% of 16 months so far).`
      : "";
  return (
    <Alert variant="info">
      <AlertDescription>
        {currentStart < oldestDate
          ? `Only ${stored} is stored so far, so this period shows those days and has no previous period to compare with. Longer periods show the same numbers until older days arrive.`
          : `The previous period is only partly stored (history starts ${formatDay(oldestDate)}), so the changes are incomplete.`}
        {loading}
      </AlertDescription>
    </Alert>
  );
}
