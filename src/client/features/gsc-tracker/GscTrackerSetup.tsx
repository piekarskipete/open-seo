import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { EmptyState } from "@/client/components/EmptyState";
import { PermissionHint } from "@/client/components/PermissionHint";
import { Alert, AlertDescription } from "@/client/components/ui/alert";
import { Button } from "@/client/components/ui/button";
import {
  formatDay,
  shiftDay,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
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
  startGscTracker,
  stopGscTracker,
  syncGscTracker,
  type getGscTrackerStatus,
} from "@/serverFunctions/gscTracker";
import type {
  GscTrackerDateFormat,
  GscTrackerPositionFormat,
  GscTrackerSortKey,
} from "@/shared/gsc-tracker";

// Turning the tracker on and off, and its sync status.

export function StartTracking({
  projectId,
  canManage,
  siteUrl,
}: {
  projectId: string;
  canManage: boolean;
  siteUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const start = useMutation({
    meta: { errorToast: false },
    mutationFn: () => startGscTracker({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Tracking started");
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerStatus", projectId],
      });
    },
  });
  return (
    <EmptyState
      variant="card"
      icon={History}
      title="Keep your Search Console history"
      description={
        <>
          OpenSEO fetches{" "}
          {siteUrl ? <strong>{siteUrl}</strong> : "your property"} day by day,
          up to 16 months back, and keeps it up to date. Trends, winners and
          losers, and competing pages then load from your own database.
          {start.error ? (
            <span role="alert" className="mt-2 block text-destructive">
              {getStandardErrorMessage(start.error)}
            </span>
          ) : null}
        </>
      }
      action={
        canManage ? (
          <Button onClick={() => start.mutate()} pending={start.isPending}>
            Start tracking
          </Button>
        ) : (
          <PermissionHint action="start tracking" />
        )
      }
    />
  );
}

type Status = Awaited<ReturnType<typeof getGscTrackerStatus>>;

export function TrackerStatus({
  projectId,
  status,
}: {
  projectId: string;
  status: Status;
}) {
  const queryClient = useQueryClient();
  const [confirmStop, setConfirmStop] = useState(false);
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("gscTracker") &&
        query.queryKey[1] === projectId,
    });
  const sync = useMutation({
    mutationFn: () => syncGscTracker({ data: { projectId } }),
    onSuccess: () => void refresh(),
  });
  const stop = useMutation({
    mutationFn: () => stopGscTracker({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Tracking stopped and history deleted");
      setConfirmStop(false);
      void refresh();
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
              Stop tracking
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
          title="Stop tracking?"
          confirmLabel="Stop and delete history"
          destructive
          pending={stop.isPending}
          onConfirm={() => stop.mutate()}
          onClose={() => setConfirmStop(false)}
        >
          This deletes the stored Search Console history for this project.
          Search Console itself is not affected, and you can start again later.
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
  positionFormat,
  explorerSort,
  dateFormat,
}: {
  projectId: string;
  positionFormat: GscTrackerPositionFormat;
  explorerSort: GscTrackerSortKey;
  dateFormat: GscTrackerDateFormat;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (settings: Settings) =>
      updateGscTrackerSettings({ data: { projectId, ...settings } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerStatus", projectId],
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
              items={POSITION_FORMATS.map((item) => ({ ...item, icon: null }))}
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
