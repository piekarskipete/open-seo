import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  formatMetric,
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  StartCell,
  TrendCell,
} from "@/client/features/gsc-tracker/GscTrackerKeywordStats";
import { TagChip } from "@/client/features/gsc-tracker/GscTrackerTagChip";
import type { Tag } from "@/client/features/gsc-tracker/gscTrackerTags";
import type { getGscTrackerKeywords } from "@/serverFunctions/gscTracker";

type Keyword = Awaited<
  ReturnType<typeof getGscTrackerKeywords>
>["keywords"][number];
type Page = Keyword["pages"][number];

/** Four right-aligned columns: clicks, impressions, CTR, position. */
export function MetricColumns({
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

export function KeywordRow({
  projectId,
  canManage,
  keyword,
  tags,
  checked,
  onCheck,
  open,
  onToggle,
}: {
  projectId: string;
  canManage: boolean;
  keyword: Keyword;
  tags: Tag[];
  checked: boolean;
  onCheck: (checked: boolean) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const monthValues = useMonthValues();
  const target = keyword.pages.find((page) => page.isTarget);
  return (
    <div className="flex w-full items-center gap-4 px-3 py-2.5 text-sm hover:bg-muted/40">
      {canManage ? (
        <Checkbox
          aria-label={`Select ${keyword.query}`}
          checked={checked}
          onCheckedChange={(value) => onCheck(value === true)}
        />
      ) : null}
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
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                name={tag.name}
                color={tag.color}
                className="ml-1.5"
              />
            ))}
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
