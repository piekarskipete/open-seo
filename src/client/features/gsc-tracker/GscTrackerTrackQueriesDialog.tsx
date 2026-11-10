import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { TagChip } from "@/client/features/saved-keywords/TagChip";
import {
  refreshTags,
  useTags,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { trackGscTrackerQueries } from "@/serverFunctions/gscTracker";
import type { GscTrackerRangeDays } from "@/shared/gsc-tracker";
import { parseSavedKeywordTagInput } from "@/shared/saved-keyword-tags";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Follows the selected Query Explorer queries in the tracker, each with its
 * top page in the period as the target URL, with tags, a start date and
 * checkpoints set at once (all optional).
 */
export function TrackQueriesDialog({
  projectId,
  queries,
  days,
  page,
  onDone,
  onClose,
}: {
  projectId: string;
  queries: string[];
  days: GscTrackerRangeDays;
  /** The Explorer's URL filter: targets come from matching pages only. */
  page?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tags = useTags(projectId, siteId).data ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [newTags, setNewTags] = useState("");
  const [startDate, setStartDate] = useState("");
  const [checkpoint1, setCheckpoint1] = useState("");
  const [checkpoint2, setCheckpoint2] = useState("");
  const checkpoints = [checkpoint1, checkpoint2].filter((day) => DAY.test(day));
  const disorder = checkpoints.length === 2 && checkpoint2 <= checkpoint1;

  const track = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      trackGscTrackerQueries({
        data: {
          projectId,
          siteId,
          days,
          queries,
          page: page || undefined,
          tags: [
            ...tags
              .filter((tag) => picked.includes(tag.id))
              .map((tag) => tag.name),
            ...parseSavedKeywordTagInput(newTags),
          ],
          startDate: DAY.test(startDate) ? startDate : undefined,
          checkpoints: checkpoints.length > 0 ? checkpoints : undefined,
        },
      }),
    onSuccess: (result) => {
      const parts = [
        `Following ${result.added} new phrase${result.added === 1 ? "" : "s"}`,
        result.alreadyFollowed > 0
          ? `${result.alreadyFollowed} already followed`
          : null,
        result.withoutPage > 0
          ? `${result.withoutPage} without a page in this period`
          : null,
      ].filter(Boolean);
      toast.success(parts.join(", "), {
        action: {
          label: "Open",
          onClick: () =>
            void navigate({
              to: "/p/$projectId/gsc-tracker/$siteId",
              params: { projectId, siteId },
              search: { tab: "keywords", days: 28 },
            }),
        },
      });
      refreshTags(queryClient, siteId);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerTargets", siteId],
      });
      onDone();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !track.isPending && onClose()}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Add {queries.length} quer{queries.length === 1 ? "y" : "ies"} to GSC
            Tracker
          </DialogTitle>
          <DialogDescription>
            Each query is followed with the page that earned it the most clicks
            in this period
            {page ? `, among pages whose URL contains “${page}”` : ""}. Tags,
            start date and checkpoints are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Tags</Label>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  selected={picked.includes(tag.id)}
                  onClick={() =>
                    setPicked((current) =>
                      current.includes(tag.id)
                        ? current.filter((id) => id !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          <Input
            value={newTags}
            onChange={(event) => setNewTags(event.target.value)}
            placeholder="New tags, separated by commas"
            aria-label="New tags"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span>Start date</span>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>Checkpoint 1</span>
            <Input
              type="date"
              value={checkpoint1}
              onChange={(event) => setCheckpoint1(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>Checkpoint 2</span>
            <Input
              type="date"
              value={checkpoint2}
              disabled={!DAY.test(checkpoint1)}
              onChange={(event) => setCheckpoint2(event.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Without a start date, each phrase measures from the day it&apos;s
          added. Phrases already followed get the tags, start date and
          checkpoints too.
        </p>
        {disorder ? (
          <p role="alert" className="text-xs text-destructive">
            Checkpoint 2 has to come after checkpoint 1.
          </p>
        ) : null}
        {track.error ? (
          <p role="alert" className="text-sm text-destructive">
            {getStandardErrorMessage(track.error)}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={track.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => track.mutate()}
            disabled={disorder}
            pending={track.isPending}
          >
            Add to GSC Tracker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
