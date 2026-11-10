import { Fragment, useState } from "react";
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
  formatPosition,
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
        Each day is fetched from Search Console on its own, so a cell is the
        phrase&apos;s position on the target URL that day only. A highlighted
        cell means another of your pages got more clicks or impressions for the
        phrase that day; open the phrase to compare every page.
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
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="sticky left-0 z-10 min-w-64 bg-card px-3 py-2 text-left font-medium">
              Phrase / page
            </th>
            {data.days.map((day) => (
              <th key={day} className="w-9 px-1 py-2 text-center font-medium">
                {Number(day.slice(8))}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Avg</th>
            <th className="px-2 py-2 text-right font-medium">Clicks</th>
            <th className="px-3 py-2 text-right font-medium">Impr.</th>
          </tr>
        </thead>
        <tbody>
          {data.keywords.map((keyword) => (
            <Fragment key={keyword.id}>
              <KeywordRow
                keyword={keyword}
                days={data.days}
                open={expanded.has(keyword.id)}
                onToggle={() => onToggle(keyword.id)}
              />
              {expanded.has(keyword.id) ? (
                <KeywordPages
                  projectId={projectId}
                  keyword={keyword}
                  days={data.days}
                  canManage={canManage}
                />
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeywordRow({
  keyword,
  days,
  open,
  onToggle,
}: {
  keyword: Keyword;
  days: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const target = keyword.pages.find((page) => page.isTarget);
  const outranked = new Set(keyword.outrankedDays);
  return (
    <tr className="border-b hover:bg-muted/40">
      <td className="sticky left-0 z-10 bg-card px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-1.5 text-left"
        >
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
        </button>
      </td>
      <DayCells page={target} days={days} outranked={outranked} />
      <Totals page={target} />
    </tr>
  );
}

/** A page's position per day, colored by the move from the day before. */
function DayCells({
  page,
  days,
  outranked,
}: {
  page: Page | undefined;
  days: string[];
  outranked?: Set<string>;
}) {
  const positionFormat = usePositionFormat();
  return days.map((day, index) => {
    const today = page?.days[day]?.position;
    const before =
      index > 0 ? page?.days[days[index - 1]]?.position : undefined;
    const move =
      today === undefined || before === undefined ? 0 : before - today;
    const beaten = outranked?.has(day) ?? false;
    return (
      <td
        key={day}
        title={
          beaten
            ? "Another page got more clicks or impressions for this phrase this day."
            : undefined
        }
        className={cn(
          "px-1 py-2 text-center text-xs tabular-nums",
          beaten && "bg-warning/15",
          move >= 0.5 && "text-success",
          move <= -0.5 && "text-destructive",
        )}
      >
        {today === undefined ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          formatPosition(today, positionFormat)
        )}
      </td>
    );
  });
}

function Totals({ page }: { page: Page | undefined }) {
  const positionFormat = usePositionFormat();
  return (
    <>
      <td className="px-2 py-2 text-right text-xs tabular-nums">
        {formatMetric("position", page?.position ?? null, positionFormat)}
      </td>
      <td className="px-2 py-2 text-right text-xs tabular-nums">
        {formatMetric("clicks", page?.clicks ?? null)}
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">
        {formatMetric("impressions", page?.impressions ?? null)}
      </td>
    </>
  );
}

/** Every page Search Console showed for the phrase this month. */
function KeywordPages({
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
  return (
    <>
      {keyword.pages.length === 0 ? (
        <tr className="border-b bg-muted/30">
          <td
            colSpan={days.length + 4}
            className="px-8 py-2 text-xs text-muted-foreground"
          >
            No page of yours showed for this phrase in this month.
          </td>
        </tr>
      ) : null}
      {keyword.pages.map((page) => (
        <tr key={page.url} className="border-b bg-muted/30">
          <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 pl-8 text-xs">
            <span className="break-all">{page.url}</span>
            {page.isTarget ? (
              <Badge variant="success" className="ml-2">
                Target
              </Badge>
            ) : page.stronger ? (
              <Badge variant="warning" className="ml-2">
                Stronger than target
              </Badge>
            ) : null}
          </td>
          <DayCells page={page} days={days} />
          <Totals page={page} />
        </tr>
      ))}
      {canManage ? (
        <tr className="border-b bg-muted/30">
          <td colSpan={days.length + 4} className="px-8 py-1.5">
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2 text-muted-foreground hover:text-destructive"
              pending={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Stop following this phrase
            </Button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
