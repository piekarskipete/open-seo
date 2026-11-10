import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  formatMetric,
  formatDayLabel,
  formatPosition,
  useDateFormat,
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { AddPhrasesDialog } from "@/client/features/gsc-tracker/GscTrackerAddPhrases";
import {
  getGscTrackerKeywords,
  removeGscTrackerKeyword,
} from "@/serverFunctions/gscTracker";

type Month = Awaited<ReturnType<typeof getGscTrackerKeywords>>;
type Keyword = Month["keywords"][number];
type Page = Keyword["pages"][number];

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function KeywordsTab({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const result = useQuery({
    queryKey: ["gscTrackerKeywords", projectId, month],
    queryFn: () => getGscTrackerKeywords({ data: { projectId, month } }),
  });
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={result.data?.month ?? month}
          onValueChange={(value) => {
            if (typeof value === "string") setMonth(value);
          }}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Month">
            <SelectValue>
              {(value: string) => (value ? monthLabel(value) : "Month")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(result.data?.months ?? []).map((value) => (
              <SelectItem key={value} value={value}>
                {monthLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add phrases
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Clicks, impressions, CTR and average position are the month&apos;s
        totals for the target URL. Open a phrase to see its position on each day
        of the month (each day fetched from Search Console on its own) and any
        page of yours that beat it. Green days moved up since the day before and
        red days moved down, stronger the bigger the move; an outlined day means
        another page got more clicks or impressions than the target.
      </p>
      {result.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : result.isError ? (
        <QueryError
          error={result.error}
          fallback="Couldn't load the followed phrases."
          onRetry={() => void result.refetch()}
          isRetrying={result.isFetching}
        />
      ) : result.data.keywords.length === 0 ? (
        <EmptyState
          title="No phrases followed yet"
          description="Add a phrase and the URL that should rank for it to see its position every day."
        />
      ) : (
        <KeywordTable
          projectId={projectId}
          data={result.data}
          expanded={expanded}
          onToggle={toggle}
          canManage={canManage}
        />
      )}
      {adding ? (
        <AddPhrasesDialog
          projectId={projectId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

/** Month totals per phrase on the left/right; days open below on demand. */
function KeywordTable({
  projectId,
  data,
  expanded,
  onToggle,
  canManage,
}: {
  projectId: string;
  data: Month;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
}) {
  return (
    <div className="divide-y rounded-lg border bg-card">
      <div className="flex items-center gap-4 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="flex-1">Phrase / target URL</span>
        <MetricColumns
          values={["Clicks", "Impr.", "CTR", "Position"]}
          label="Month totals for the target URL"
        />
      </div>
      {data.keywords.map((keyword) => (
        <div key={keyword.id}>
          <KeywordRow
            keyword={keyword}
            open={expanded.has(keyword.id)}
            onToggle={() => onToggle(keyword.id)}
          />
          {expanded.has(keyword.id) ? (
            <KeywordDetail
              projectId={projectId}
              keyword={keyword}
              days={data.days}
              canManage={canManage}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Four right-aligned columns: clicks, impressions, CTR, position. */
function MetricColumns({
  values,
  label,
}: {
  values: [string, string, string, string];
  label?: string;
}) {
  return (
    <span
      className="grid shrink-0 grid-cols-4 gap-2 text-right tabular-nums"
      aria-label={label}
    >
      {values.map((value, index) => (
        <span key={index} className="w-14 sm:w-16">
          {value}
        </span>
      ))}
    </span>
  );
}

function useMonthValues() {
  const positionFormat = usePositionFormat();
  return (page: Page | undefined): [string, string, string, string] => [
    formatMetric("clicks", page?.clicks ?? null),
    formatMetric("impressions", page?.impressions ?? null),
    formatMetric(
      "ctr",
      page && page.impressions > 0 ? page.clicks / page.impressions : null,
    ),
    formatMetric("position", page?.position ?? null, positionFormat),
  ];
}

function KeywordRow({
  keyword,
  open,
  onToggle,
}: {
  keyword: Keyword;
  open: boolean;
  onToggle: () => void;
}) {
  const monthValues = useMonthValues();
  const target = keyword.pages.find((page) => page.isTarget);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-4 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
    >
      <span className="flex min-w-0 flex-1 items-start gap-1.5">
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="font-medium">{keyword.query}</span>
          {keyword.cannibalized ? (
            <Badge variant="warning" className="ml-2">
              Competing pages
            </Badge>
          ) : null}
          <span className="block truncate text-xs text-muted-foreground">
            {keyword.targetUrl}
          </span>
          {keyword.newestDate ? null : (
            <span className="block text-xs text-muted-foreground">
              Fetching the first days…
            </span>
          )}
        </span>
      </span>
      <MetricColumns values={monthValues(target)} />
    </button>
  );
}

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
function KeywordDetail({
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
  const outranked = new Set(keyword.outrankedDays);
  const target = keyword.pages.find((page) => page.isTarget);
  const stronger = keyword.pages.filter((page) => page.stronger);
  const remove = useMutation({
    mutationFn: () =>
      removeGscTrackerKeyword({ data: { projectId, id: keyword.id } }),
    onSuccess: () => {
      toast.success(`Stopped following “${keyword.query}”`);
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
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2 text-muted-foreground hover:text-destructive"
          pending={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Stop following this phrase
        </Button>
      ) : null}
    </div>
  );
}
