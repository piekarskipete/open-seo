import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "cn";
import { Badge } from "@/client/components/ui/badge";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import { StartDateButton } from "@/client/features/gsc-tracker/GscTrackerKeywordStats";
import {
  formatDayLabel,
  formatPosition,
  useDateFormat,
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  removeGscTrackerKeyword,
  type getGscTrackerKeywords,
} from "@/serverFunctions/gscTracker";

type Keyword = Awaited<
  ReturnType<typeof getGscTrackerKeywords>
>["keywords"][number];
type Page = Keyword["pages"][number];

// Backgrounds by how far a position moved since the day before: the bigger
// the move, the stronger the color.
const UP_TONES = ["bg-success/15", "bg-success/30", "bg-success/50"];
const DOWN_TONES = [
  "bg-destructive/15",
  "bg-destructive/30",
  "bg-destructive/50",
];

/** A day's tone: green when the position improved, red when it dropped. */
function moveTone(move: number): string {
  const size = Math.abs(move);
  if (size < 0.5) return "bg-card";
  const level = size >= 5 ? 2 : size >= 2 ? 1 : 0;
  return move > 0 ? UP_TONES[level] : DOWN_TONES[level];
}

/**
 * One cell per day of the month with that day's position only, all on one
 * line: the cells share the width, so a whole month fits without scrolling.
 */
function DayGrid({
  page,
  days,
  outranked,
}: {
  page: Page;
  days: string[];
  outranked?: Set<string>;
}) {
  const positionFormat = usePositionFormat();
  const dateFormat = useDateFormat();
  return (
    <div
      className="grid gap-0.5"
      style={{
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      {days.map((day, index) => {
        const today = page.days[day]?.position;
        const before =
          index > 0 ? page.days[days[index - 1]]?.position : undefined;
        const move =
          today === undefined || before === undefined ? 0 : before - today;
        const beaten = outranked?.has(day) ?? false;
        return (
          <div
            key={day}
            title={
              beaten
                ? "Another page got more clicks or impressions for this phrase this day."
                : undefined
            }
            className={cn(
              "min-w-0 overflow-hidden rounded border py-0.5 text-center tabular-nums",
              moveTone(move),
              beaten && "border-warning ring-1 ring-warning ring-inset",
            )}
          >
            <div className="truncate text-[9px] leading-tight text-muted-foreground">
              {formatDayLabel(day, dateFormat)}
            </div>
            <div className="truncate text-[11px] leading-tight">
              {today === undefined ? (
                <span className="text-muted-foreground">–</span>
              ) : (
                formatPosition(today, positionFormat)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Every page Search Console showed for the phrase this month, day by day. */
export function KeywordDetail({
  projectId,
  keyword,
  days,
  canManage,
}: {
  projectId: string;
  keyword: Keyword;
  days: string[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmStop, setConfirmStop] = useState(false);
  const outranked = new Set(keyword.outrankedDays);
  const target = keyword.pages.find((page) => page.isTarget);
  const stronger = keyword.pages.filter((page) => page.stronger);
  const remove = useMutation({
    mutationFn: () =>
      removeGscTrackerKeyword({ data: { projectId, id: keyword.id } }),
    onSuccess: () => {
      toast.success(`Stopped following “${keyword.query}”`);
      setConfirmStop(false);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
    },
  });
  // Daily positions are for the followed URL only; pages that beat it are
  // named, nothing more.
  return (
    <div className="space-y-3 bg-muted/30 px-3 py-3 sm:pl-8">
      {target ? (
        <DayGrid page={target} days={days} outranked={outranked} />
      ) : (
        <p className="text-xs text-muted-foreground">
          The target URL didn&apos;t show for this phrase in this month.
        </p>
      )}
      {stronger.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {stronger.map((page) => (
            <li key={page.url} className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">Stronger URL</Badge>
              <span className="min-w-0 break-all">{page.url}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <StartDateButton
            projectId={projectId}
            ids={[keyword.id]}
            initialDate={keyword.startDate}
            canReset={!keyword.startIsDefault}
            className="text-muted-foreground"
          />
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmStop(true)}
          >
            Stop following this phrase
          </Button>
        </div>
      ) : null}
      {confirmStop ? (
        <ConfirmDialog
          title={`Stop following “${keyword.query}”?`}
          confirmLabel="Stop following"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirmStop(false)}
        >
          Its daily positions for {keyword.targetUrl} are deleted, along with
          its tags and start date. You can follow it again later; its history is
          then fetched again from Search Console.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
