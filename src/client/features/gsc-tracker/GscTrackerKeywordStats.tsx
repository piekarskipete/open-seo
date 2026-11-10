import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { setGscTrackerKeywordStart } from "@/serverFunctions/gscTracker";

/** A day with its year: "03.10.2026" or "Oct 3, 2026". */
function fullDay(day: string, dateFormat: "dd.mm" | "mon-d"): string {
  return dateFormat === "dd.mm"
    ? `${formatDayLabel(day, dateFormat)}.${day.slice(0, 4)}`
    : `${formatDayLabel(day, dateFormat)}, ${day.slice(0, 4)}`;
}

/**
 * The start of a phrase's progress: its date (the day it was added unless
 * set by hand) and the position measured then. Members who manage
 * integrations can pick another date.
 */
export function StartCell({
  projectId,
  keywordId,
  startDate,
  startIsDefault,
  start,
  canManage,
}: {
  projectId: string;
  keywordId: string;
  startDate: string;
  startIsDefault: boolean;
  start: { date: string; position: number } | null;
  canManage: boolean;
}) {
  const positionFormat = usePositionFormat();
  const dateFormat = useDateFormat();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(startDate);
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (next: string | null) =>
      setGscTrackerKeywordStart({
        data: { projectId, id: keywordId, startDate: next },
      }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
    },
  });
  const label = (
    <>
      <span className="block text-[11px] text-muted-foreground">
        {fullDay(startDate, dateFormat)}
      </span>
      <span className="block">
        {start ? formatPosition(start.position, positionFormat) : "–"}
      </span>
    </>
  );
  if (!canManage)
    return <span className="w-24 shrink-0 text-right">{label}</span>;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(startDate);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="w-24 shrink-0 rounded text-right hover:bg-muted"
            title={
              start && start.date !== startDate
                ? `First measured on ${fullDay(start.date, dateFormat)}`
                : "Change the start date"
            }
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Start date</PopoverTitle>
          <PopoverDescription>
            Progress is measured from this day&apos;s position, or the first
            measured day after it.
            {startIsDefault ? " It is the day the phrase was added." : ""}
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
          {startIsDefault ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Use the day added
            </Button>
          )}
          <Button
            size="sm"
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(value)}
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
