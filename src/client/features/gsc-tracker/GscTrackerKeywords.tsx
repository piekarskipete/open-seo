import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
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
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { AddPhrasesDialog } from "@/client/features/gsc-tracker/GscTrackerAddPhrases";
import { KeywordDetail } from "@/client/features/gsc-tracker/GscTrackerKeywordDetail";
import {
  StartCell,
  TrendCell,
} from "@/client/features/gsc-tracker/GscTrackerKeywordStats";
import { getGscTrackerKeywords } from "@/serverFunctions/gscTracker";

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
        <span className="w-24 shrink-0 text-right">Start</span>
        <span className="w-20 shrink-0 text-right">Last month</span>
        <span className="w-20 shrink-0 text-right">Latest</span>
      </div>
      {data.keywords.map((keyword) => (
        <div key={keyword.id}>
          <KeywordRow
            projectId={projectId}
            canManage={canManage}
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
  projectId,
  canManage,
  keyword,
  open,
  onToggle,
}: {
  projectId: string;
  canManage: boolean;
  keyword: Keyword;
  open: boolean;
  onToggle: () => void;
}) {
  const monthValues = useMonthValues();
  const target = keyword.pages.find((page) => page.isTarget);
  return (
    <div className="flex w-full items-center gap-4 px-3 py-2.5 text-sm hover:bg-muted/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
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
              <Badge
                variant="warning"
                className="ml-2"
                title={`${keyword.competingPages} other page${keyword.competingPages === 1 ? "" : "s"} earned more clicks or impressions for this phrase this month`}
              >
                Competing pages ({keyword.competingPages})
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
      <span className="flex shrink-0 items-center gap-4 tabular-nums">
        <StartCell
          projectId={projectId}
          keywordId={keyword.id}
          startDate={keyword.startDate}
          startIsDefault={keyword.startIsDefault}
          start={keyword.start}
          canManage={canManage}
        />
        <TrendCell
          value={keyword.lastMonth}
          title="Last month's average position, and the move into this month"
        />
        <TrendCell
          value={keyword.latest}
          title={
            keyword.latest
              ? `Position on the month's last measured day (${keyword.latest.date}), and the move since the day before`
              : undefined
          }
        />
      </span>
    </div>
  );
}
