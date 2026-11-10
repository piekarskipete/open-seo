import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Flag } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  formatDayLabel,
  formatPosition,
  useDateFormat,
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  setGscTrackerKeywordCheckpoints,
  setGscTrackerKeywordStart,
} from "@/serverFunctions/gscTracker";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day with its year: "03.10.2026" or "Oct 3, 2026". */
function fullDay(day: string, dateFormat: "dd.mm" | "mon-d"): string {
  return dateFormat === "dd.mm"
    ? `${formatDayLabel(day, dateFormat)}.${day.slice(0, 4)}`
    : `${formatDayLabel(day, dateFormat)}, ${day.slice(0, 4)}`;
}

/**
 * The start of a phrase's progress: its date (the day it was added unless
 * set by hand) and the position measured then.
 */
export function StartCell({
  startDate,
  startIsDefault,
  start,
}: {
  startDate: string;
  startIsDefault: boolean;
  start: { date: string; position: number } | null;
}) {
  const positionFormat = usePositionFormat();
  const dateFormat = useDateFormat();
  const title = [
    startIsDefault ? "The day the phrase was added" : "Start date set by hand",
    start && start.date !== startDate
      ? `first measured on ${fullDay(start.date, dateFormat)}`
      : null,
  ]
    .filter(Boolean)
    .join("; ");
  return (
    <span className="w-24 shrink-0 text-right" title={title}>
      <span className="block text-[11px] text-muted-foreground">
        {fullDay(startDate, dateFormat)}
      </span>
      <span className="block">
        {start ? formatPosition(start.position, positionFormat) : "–"}
      </span>
    </span>
  );
}

/**
 * "Set start date" for one phrase or every selected one: progress is
 * measured from that day's position, or from the day each phrase was added.
 */
export function StartDateButton({
  projectId,
  ids,
  initialDate,
  canReset,
  className,
  outline = false,
}: {
  projectId: string;
  ids: string[];
  /** The date the picker opens on. */
  initialDate: string;
  /** Offer "Use the day added" (a phrase has a date set by hand). */
  canReset: boolean;
  className?: string;
  /** An outlined, toolbar-sized trigger instead of a quiet link-like one. */
  outline?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialDate);
  const many = ids.length > 1;
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (next: string | null) =>
      setGscTrackerKeywordStart({
        data: { projectId, ids, startDate: next },
      }),
    onSuccess: (result) => {
      setOpen(false);
      if (many) toast.success(`Start date set for ${result.updated} phrases`);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
    },
  });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(initialDate);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant={outline ? "outline" : "ghost"}
            size={outline ? "sm" : "xs"}
            className={className}
          />
        }
      >
        <CalendarDays className="size-3.5" />
        Set start date
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>
            {many ? `Start date for ${ids.length} phrases` : "Start date"}
          </PopoverTitle>
          <PopoverDescription>
            Progress is measured from this day&apos;s position, or the first
            measured day after it.
          </PopoverDescription>
        </PopoverHeader>
        <Input
          type="date"
          aria-label="Start date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {save.error ? (
          <p role="alert" className="text-xs text-destructive">
            {getStandardErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-1">
          {canReset ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Use the day added
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!DAY.test(value)}
            pending={save.isPending}
            onClick={() => save.mutate(value)}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Checkpoints" for one phrase or every selected one: up to two days to
 * measure progress up to, shown on the phrase's chart.
 */
export function CheckpointsButton({
  projectId,
  ids,
  initial,
  outline = false,
}: {
  projectId: string;
  ids: string[];
  /** The days the picker opens on. */
  initial: string[];
  outline?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(initial[0] ?? "");
  const [second, setSecond] = useState(initial[1] ?? "");
  const many = ids.length > 1;
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (checkpoints: string[]) =>
      setGscTrackerKeywordCheckpoints({
        data: { projectId, ids, checkpoints },
      }),
    onSuccess: (result) => {
      setOpen(false);
      if (many) toast.success(`Checkpoints set for ${result.updated} phrases`);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywordChart", projectId],
      });
    },
  });
  const days = [first, second].filter((day) => DAY.test(day));
  const disorder = days.length === 2 && second <= first;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFirst(initial[0] ?? "");
          setSecond(initial[1] ?? "");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant={outline ? "outline" : "ghost"}
            size={outline ? "sm" : "xs"}
            className={outline ? undefined : "text-muted-foreground"}
          />
        }
      >
        <Flag className="size-3.5" />
        {initial.length > 0 ? `Checkpoints (${initial.length})` : "Checkpoints"}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>
            {many ? `Checkpoints for ${ids.length} phrases` : "Checkpoints"}
          </PopoverTitle>
          <PopoverDescription>
            Up to two days to measure progress to. With one, the chart shows
            start to checkpoint; with two, checkpoint 1 to checkpoint 2.
          </PopoverDescription>
        </PopoverHeader>
        <label className="space-y-1 text-xs">
          <span>Checkpoint 1</span>
          <Input
            type="date"
            value={first}
            onChange={(event) => setFirst(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span>Checkpoint 2 (optional)</span>
          <Input
            type="date"
            value={second}
            disabled={!DAY.test(first)}
            onChange={(event) => setSecond(event.target.value)}
          />
        </label>
        {disorder ? (
          <p role="alert" className="text-xs text-destructive">
            Checkpoint 2 has to come after checkpoint 1.
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-xs text-destructive">
            {getStandardErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-1">
          {initial.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate([])}
            >
              Remove checkpoints
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={days.length === 0 || disorder}
            pending={save.isPending}
            onClick={() => save.mutate(days)}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A position with its move: ▲ green when it improved (a smaller number),
 * ▼ red when it dropped.
 */
export function TrendCell({
  value,
  title,
}: {
  value: { position: number; change: number | null } | null;
  title?: string;
}) {
  const positionFormat = usePositionFormat();
  const change = value?.change ?? null;
  const shown =
    change !== null &&
    Math.abs(change) >= (positionFormat === "whole" ? 0.5 : 0.05);
  return (
    <span className="w-20 shrink-0 text-right" title={title}>
      <span className="block">
        {value ? formatPosition(value.position, positionFormat) : "–"}
      </span>
      {shown ? (
        <span
          className={cn(
            "block text-[11px]",
            change > 0 ? "text-success" : "text-destructive",
          )}
        >
          {change > 0 ? "▲" : "▼"}{" "}
          {formatPosition(Math.abs(change), positionFormat)}
        </span>
      ) : null}
    </span>
  );
}
