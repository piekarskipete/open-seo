import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { TableBulkActionButton } from "@/client/components/table/TableBulkActionBar";
import {
  AGREEMENT_STYLES,
  placesApart,
  useRank,
} from "@/client/features/gsc-tracker/gscTrackerRank";
import { compareDay, summarizeRank } from "@/shared/gsc-tracker-rank";
import {
  formatDayLabel,
  useDateFormat,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { addTrackingKeywords } from "@/serverFunctions/rank-tracking";
import { comparableUrl } from "@/shared/gsc-tracker";
import type { getGscTrackerKeywords } from "@/serverFunctions/gscTracker";

type Keyword = Awaited<
  ReturnType<typeof getGscTrackerKeywords>
>["keywords"][number];

function targetDays(keyword: Keyword) {
  return keyword.pages.find((page) => page.isTarget)?.days ?? {};
}

/** Adds phrases to the linked Rank Tracking domain, as Rank Tracking's own
 *  "Add keywords" does (its first check and schedule included). */
function useAddToRankTracker() {
  const rank = useRank();
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const configId = rank?.data?.link?.configId;
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: (queries: string[]) =>
      addTrackingKeywords({
        data: {
          projectId: rank?.projectId ?? "",
          configId: configId ?? "",
          keywords: queries,
        },
      }),
    onSuccess: (result) => {
      toast.success(
        `Added ${result.added} phrase${result.added === 1 ? "" : "s"} to Rank Tracking`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerRank", siteId],
      });
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Couldn't add to Rank Tracking"),
      ),
  });
  return { add, ready: Boolean(configId) };
}

/** The row's Rank Tracking position and whether it agrees with Search
 *  Console this month. */
export function RankBadge({ keyword }: { keyword: Keyword }) {
  const rank = useRank();
  const entry = rank?.data?.keywords[keyword.id];
  if (!rank?.data?.link || !entry) return null;
  if (!entry.trackingKeywordId)
    return (
      <Badge
        variant="secondary"
        title="This phrase isn't in the linked Rank Tracking domain."
      >
        <span className="hidden min-[1800px]:inline">Not in Rank Tracking</span>
        <span className="hidden 2xl:max-[1799px]:inline">Not in RT</span>
        <span className="2xl:hidden">No RT</span>
      </Badge>
    );
  const summary = summarizeRank({
    gscDays: targetDays(keyword),
    rankDays: entry.days,
    targetUrl: keyword.targetUrl,
  });
  const latest =
    summary.latest === null
      ? "no check yet"
      : summary.latest.position === null
        ? "not found"
        : `position ${summary.latest.position}`;
  if (summary.compared === 0)
    return (
      <Badge
        variant="secondary"
        title={`No day with both Search Console and Rank Tracking positions this month. Latest Rank Tracking check: ${latest}.`}
      >
        <span className="hidden min-[1800px]:inline">
          Rank Tracking: no overlap yet
        </span>
        <span className="min-[1800px]:hidden">RT –</span>
      </Badge>
    );
  // Shares of the days both sources measured: within 10 places, or not.
  const matchShare = Math.round((summary.agreeing / summary.compared) * 100);
  const differShare = 100 - matchShare;
  return (
    <Badge
      variant={summary.verdict === "agrees" ? "info" : "warning"}
      title={`${summary.agreeing} of ${summary.compared} days within 10 places of Search Console. Latest Rank Tracking check: ${latest}${summary.otherUrl ? `, on ${summary.otherUrl}` : ""}.`}
    >
      {summary.verdict === "agrees" ? "✓" : "!"}{" "}
      <span className="hidden min-[1800px]:inline">
        Rank Tracking: {matchShare}% match
        {differShare > 0 ? ` · ${differShare}% differ` : ""}
      </span>
      <span className="hidden 2xl:max-[1799px]:inline">
        RT {matchShare}%{differShare > 0 ? ` · ${differShare}% off` : ""}
      </span>
      <span className="hidden xl:inline 2xl:hidden">RT {matchShare}%</span>
      <span className="xl:hidden">{matchShare}%</span>
    </Badge>
  );
}

/** Rank Tracking's day-by-day positions under Search Console's, each day
 *  marked by how well they agree. */
export function RankDetail({
  keyword,
  days,
  canManage,
}: {
  keyword: Keyword;
  days: string[];
  canManage: boolean;
}) {
  const rank = useRank();
  const dateFormat = useDateFormat();
  const { add, ready } = useAddToRankTracker();
  const data = rank?.data;
  if (!data) return null;
  if (!data.link)
    return (
      <p className="text-xs text-muted-foreground">
        Link a Rank Tracking domain in Settings to compare these positions with
        Rank Tracking&apos;s.
      </p>
    );
  const entry = data.keywords[keyword.id];
  if (!entry?.trackingKeywordId)
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        This phrase isn&apos;t tracked in Rank Tracking for {data.link.domain}.
        {canManage && ready ? (
          <Button
            variant="outline"
            size="xs"
            pending={add.isPending}
            onClick={() => add.mutate([keyword.query])}
          >
            <Crosshair data-icon="inline-start" />
            Add to Rank Tracking
          </Button>
        ) : null}
      </div>
    );
  const gscDays = targetDays(keyword);
  const summary = summarizeRank({
    gscDays,
    rankDays: entry.days,
    targetUrl: keyword.targetUrl,
  });
  return (
    <div className="space-y-1">
      <p className="text-xs">
        <span className="font-medium">Rank Tracking</span>
        <span className="text-muted-foreground">
          {" "}
          · one Google check a day, {data.link.device}, {data.link.domain}
          {summary.compared > 0
            ? ` · ${summary.agreeing} of ${summary.compared} days match Search Console`
            : " · no day measured by both yet"}
        </span>
      </p>
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((day) => {
          const rankDay = entry.days[day];
          const gsc = gscDays[day]?.position;
          const verdict = compareDay(gsc, rankDay);
          const style = verdict ? AGREEMENT_STYLES[verdict] : null;
          const otherPage = Boolean(
            rankDay?.url &&
            comparableUrl(rankDay.url) !== comparableUrl(keyword.targetUrl),
          );
          const tip = rankDay
            ? [
                rankDay.position === null
                  ? "Rank Tracking: not found"
                  : `Rank Tracking: ${rankDay.position}`,
                gsc === undefined
                  ? "Search Console: no data"
                  : `Search Console: ${gsc.toFixed(1)}`,
                style?.label,
                otherPage ? `Ranked: ${rankDay.url}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Not checked this day";
          const mark =
            !style || !verdict
              ? ""
              : verdict === "match" ||
                  gsc === undefined ||
                  !rankDay ||
                  rankDay.position === null
                ? style.symbol
                : placesApart(gsc, rankDay.position);
          return (
            <div
              key={day}
              title={tip}
              className={cn(
                "min-w-0 overflow-hidden rounded border py-0.5 text-center tabular-nums",
                style ? style.cell : "border-dashed bg-card",
              )}
            >
              <div className="truncate text-[9px] leading-tight text-muted-foreground">
                {formatDayLabel(day, dateFormat)}
              </div>
              <div className="truncate text-[11px] leading-tight font-medium">
                {rankDay === undefined ? (
                  <span className="text-muted-foreground">·</span>
                ) : rankDay.position === null ? (
                  <span className="text-muted-foreground">–</span>
                ) : (
                  <>
                    {rankDay.position}
                    {otherPage ? (
                      <span className="text-orange-600 dark:text-orange-400">
                        *
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <div
                className={cn(
                  "h-3 truncate text-[9px] leading-tight font-semibold",
                  style?.mark,
                )}
              >
                {mark}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        {(["match", "close", "differs"] as const).map((key) => (
          <li key={key}>
            <span className={cn("font-semibold", AGREEMENT_STYLES[key].mark)}>
              {AGREEMENT_STYLES[key].symbol}
            </span>{" "}
            {AGREEMENT_STYLES[key].label}
          </li>
        ))}
        <li>
          <span className="font-semibold">+5</span> Rank Tracking 5 places lower
          than Search Console
        </li>
        <li>
          <span className="font-semibold text-orange-600 dark:text-orange-400">
            *
          </span>{" "}
          Another page of yours ranked
        </li>
      </ul>
      {summary.otherUrl ? (
        <p className="text-xs">
          <Badge variant="warning">Other URL</Badge>{" "}
          <span className="break-all">
            Rank Tracking last found {summary.otherUrl}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** The bulk bar's action: adds the selected phrases not tracked yet. */
export function RankBulkButton({ keywords }: { keywords: Keyword[] }) {
  const rank = useRank();
  const { add, ready } = useAddToRankTracker();
  if (!ready) return null;
  const missing = keywords.filter(
    (keyword) => !rank?.data?.keywords[keyword.id]?.trackingKeywordId,
  );
  return (
    <TableBulkActionButton
      icon={<Crosshair className="size-3.5" />}
      disabled={add.isPending || missing.length === 0}
      onClick={() => add.mutate(missing.map((keyword) => keyword.query))}
    >
      Add to Rank Tracking
    </TableBulkActionButton>
  );
}
