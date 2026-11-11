import { useState } from "react";
import { ChartLine, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  formatMetric,
  usePositionFormat,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  StartCell,
  TrendCell,
} from "@/client/features/gsc-tracker/GscTrackerKeywordStats";
import { KeywordChartDialog } from "@/client/features/gsc-tracker/GscTrackerKeywordChart";
import { RankBadge } from "@/client/features/gsc-tracker/GscTrackerRankCompare";
import { TagChip } from "@/client/features/saved-keywords/TagChip";
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
  const [charting, setCharting] = useState(false);
  const target = keyword.pages.find((page) => page.isTarget);
  return (
    // A click on the row's numbers opens it too; its controls keep their own
    // clicks, and the phrase name stays the keyboard way in.
    <div
      className="flex w-full cursor-pointer items-center gap-4 px-3 py-2.5 text-sm hover:bg-muted/40"
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, input, a, [role='checkbox']")
        )
          return;
        onToggle();
      }}
    >
      {canManage ? (
        <Checkbox
          aria-label={`Select ${keyword.query}`}
          checked={checked}
          onCheckedChange={(value) => onCheck(value === true)}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 items-start gap-1.5">
        <span className="min-w-0">
          {/* Wide screens: name, Chart and status badges on one line.
              Narrower: the name gets its own line and Chart keeps the
              (shortened) badges beside it. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 2xl:flex-nowrap">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              title={keyword.query}
              className="inline-flex max-w-full min-w-0 basis-full items-center gap-1.5 text-left font-medium 2xl:basis-auto"
            >
              {open ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{keyword.query}</span>
            </button>
            <span className="flex shrink-0 items-center gap-1 pl-4 whitespace-nowrap 2xl:pl-0">
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setCharting(true)}
                aria-label={`Chart for ${keyword.query}`}
                title="Chart"
              >
                <ChartLine className="size-3.5" />
                <span className="hidden xl:inline">Chart</span>
              </Button>
              {keyword.cannibalized ? (
                <Badge
                  variant="warning"
                  title={`${keyword.competingPages} other page${keyword.competingPages === 1 ? "" : "s"} earned more clicks or impressions for this phrase this month`}
                >
                  <span className="hidden min-[1800px]:inline">
                    Competing pages ({keyword.competingPages})
                  </span>
                  <span className="hidden 2xl:max-[1799px]:inline">
                    Competing ({keyword.competingPages})
                  </span>
                  <span className="hidden xl:inline 2xl:hidden">
                    Comp. {keyword.competingPages}
                  </span>
                  <span className="xl:hidden">⚠ {keyword.competingPages}</span>
                </Badge>
              ) : null}
              <RankBadge keyword={keyword} />
            </span>
          </span>
          {tags.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1 pt-0.5 pl-5">
              {tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} size="xs" />
              ))}
            </span>
          ) : null}
          <span className="block truncate pl-5 text-xs text-muted-foreground">
            {keyword.targetUrl}
          </span>
          {keyword.newestDate ? null : (
            <span className="block pl-5 text-xs text-muted-foreground">
              Fetching the first days…
            </span>
          )}
        </span>
      </span>
      <MetricColumns values={monthValues(target)} />
      <span className="flex shrink-0 items-center gap-4 tabular-nums">
        <StartCell
          startDate={keyword.startDate}
          startIsDefault={keyword.startIsDefault}
          start={keyword.start}
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
      {charting ? (
        <KeywordChartDialog
          projectId={projectId}
          keyword={keyword}
          onClose={() => setCharting(false)}
        />
      ) : null}
    </div>
  );
}
