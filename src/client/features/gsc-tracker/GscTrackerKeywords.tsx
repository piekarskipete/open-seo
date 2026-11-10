import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { EmptyState } from "@/client/components/EmptyState";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AddPhrasesDialog } from "@/client/features/gsc-tracker/GscTrackerAddPhrases";
import {
  KeywordRow,
  MetricColumns,
} from "@/client/features/gsc-tracker/GscTrackerKeywordRow";
import { KeywordDetail } from "@/client/features/gsc-tracker/GscTrackerKeywordDetail";
import {
  KeywordBulkBar,
  KeywordTagFilter,
} from "@/client/features/gsc-tracker/GscTrackerKeywordToolbar";
import {
  matchesTagFilter,
  useTags,
  type Tag,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import { getGscTrackerKeywords } from "@/serverFunctions/gscTracker";

type Month = Awaited<ReturnType<typeof getGscTrackerKeywords>>;
type Keyword = Month["keywords"][number];

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
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const result = useQuery({
    queryKey: ["gscTrackerKeywords", projectId, month],
    queryFn: () => getGscTrackerKeywords({ data: { projectId, month } }),
  });
  const tags = useTags(projectId).data ?? [];
  // A deleted tag drops out of the filter.
  const activeFilter = tagFilter.filter((id) =>
    tags.some((tag) => tag.id === id),
  );
  const visible = (result.data?.keywords ?? []).filter((keyword) =>
    matchesTagFilter(keyword.tagIds, activeFilter),
  );
  // Only phrases still on screen count as selected, so a filter change
  // never tags phrases the user can't see.
  const selection = visible.filter((keyword) => selected.has(keyword.id));
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
        <div className="flex flex-wrap items-center gap-2">
          <KeywordTagFilter
            projectId={projectId}
            tags={tags}
            value={activeFilter}
            onChange={setTagFilter}
          />
          {canManage ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Add phrases
            </Button>
          ) : null}
        </div>
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
        <>
          {visible.length === 0 ? (
            <EmptyState
              kind="filtered"
              title="No phrases with these tags"
              description="Choose other tags or clear the filter."
            />
          ) : (
            <KeywordTable
              projectId={projectId}
              data={result.data}
              keywords={visible}
              tags={tags}
              expanded={expanded}
              onToggle={toggle}
              canManage={canManage}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </>
      )}
      {canManage ? (
        <KeywordBulkBar
          projectId={projectId}
          selected={selection.map((keyword) => keyword.id)}
          tags={tags}
          selectedTags={tags.filter((tag) =>
            selection.some((keyword) => keyword.tagIds.includes(tag.id)),
          )}
          startDate={selection[0]?.startDate ?? ""}
          anyCustomStart={selection.some((keyword) => !keyword.startIsDefault)}
          checkpoints={selection[0]?.checkpoints ?? []}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
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
  keywords,
  tags,
  expanded,
  onToggle,
  canManage,
  selected,
  onSelect,
}: {
  projectId: string;
  data: Month;
  /** The phrases the tag filter keeps. */
  keywords: Keyword[];
  tags: Tag[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
}) {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const shownSelected = keywords.filter((k) => selected.has(k.id)).length;
  const setOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelect(next);
  };
  return (
    <div className="divide-y rounded-lg border bg-card">
      <div className="flex items-center gap-4 px-3 py-2 text-xs font-medium text-muted-foreground">
        {canManage ? (
          <Checkbox
            aria-label="Select all shown phrases"
            checked={shownSelected > 0 && shownSelected === keywords.length}
            indeterminate={shownSelected > 0 && shownSelected < keywords.length}
            onCheckedChange={(checked) =>
              onSelect(
                checked
                  ? new Set(keywords.map((keyword) => keyword.id))
                  : new Set(),
              )
            }
          />
        ) : null}
        <span className="flex-1">Phrase / target URL</span>
        <MetricColumns
          values={["Clicks", "Impr.", "CTR", "Position"]}
          label="Month totals for the target URL"
        />
        <span className="w-24 shrink-0 text-right">Start</span>
        <span className="w-20 shrink-0 text-right">Last month</span>
        <span className="w-20 shrink-0 text-right">Latest</span>
      </div>
      {keywords.map((keyword) => (
        <div key={keyword.id}>
          <KeywordRow
            projectId={projectId}
            canManage={canManage}
            keyword={keyword}
            tags={keyword.tagIds.flatMap((id) => tagsById.get(id) ?? [])}
            checked={selected.has(keyword.id)}
            onCheck={(checked) => setOne(keyword.id, checked)}
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
