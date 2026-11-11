import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { TableBulkActionButton } from "@/client/components/table/TableBulkActionBar";
import {
  AGREEMENT_TONES,
  compareDay,
  summarizeRank,
  useRank,
} from "@/client/features/gsc-tracker/gscTrackerRank";
import {
  formatDayLabel,
  useDateFormat,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getGscTrackerRankComparison,
  saveGscTrackerRankLink,
} from "@/serverFunctions/gscTrackerOverview";
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
        Not in Rank Tracking
      </Badge>
    );
  const summary = summarizeRank({
    gscDays: targetDays(keyword),
    rankDays: entry.days,
    targetUrl: keyword.targetUrl,
  });
  const position =
    summary.latest === null
      ? "–"
      : summary.latest.position === null
        ? "not found"
        : `${summary.latest.position}`;
  return (
    <Badge
      variant={
        summary.verdict === "agrees"
          ? "success"
          : summary.verdict === "differs"
            ? "destructive"
            : "secondary"
      }
      title={
        summary.compared === 0
          ? "No day with both Search Console and Rank Tracking positions this month."
          : `${summary.agreeing} of ${summary.compared} days agree within 10 places${summary.otherUrl ? `. Rank Tracking found ${summary.otherUrl}` : ""}`
      }
    >
      Rank Tracking {position}
      {summary.verdict === "agrees"
        ? " · agrees"
        : summary.verdict === "differs"
          ? " · differs"
          : ""}
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
      <p className="text-xs text-muted-foreground">
        Rank Tracking · {data.link.domain} · {data.link.device}
        {summary.compared > 0
          ? ` · ${summary.agreeing} of ${summary.compared} days agree with Search Console`
          : " · no day measured by both yet"}
      </p>
      <div
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((day) => {
          const rankDay = entry.days[day];
          const verdict = compareDay(gscDays[day]?.position, rankDay);
          return (
            <div
              key={day}
              title={
                rankDay
                  ? `${rankDay.position === null ? "Not found" : `Position ${rankDay.position}`}${rankDay.url ? ` · ${rankDay.url}` : ""}${verdict ? ` · ${verdict === "match" ? "agrees" : verdict === "close" ? "close" : "differs"} with Search Console` : ""}`
                  : "Not checked this day"
              }
              className={cn(
                "min-w-0 overflow-hidden rounded border py-0.5 text-center tabular-nums",
                verdict ? AGREEMENT_TONES[verdict] : "border-dashed bg-card",
              )}
            >
              <div className="truncate text-[9px] leading-tight text-muted-foreground">
                {formatDayLabel(day, dateFormat)}
              </div>
              <div className="truncate text-[11px] leading-tight">
                {rankDay === undefined ? (
                  <span className="text-muted-foreground">·</span>
                ) : rankDay.position === null ? (
                  <span className="text-muted-foreground">–</span>
                ) : (
                  <>
                    {rankDay.position}
                    {rankDay.url &&
                    comparableUrl(rankDay.url) !==
                      comparableUrl(keyword.targetUrl) ? (
                      <span className="text-warning">*</span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-success/40" />
          within 3 places
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-warning/40" />
          within 10
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-sm bg-destructive/40" />
          further apart or not found
        </span>
        <span>
          <span className="text-warning">*</span> another URL ranked
        </span>
      </p>
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

const DEVICES = [
  { value: "mobile" as const, label: "Mobile", icon: null },
  { value: "desktop" as const, label: "Desktop", icon: null },
];

/** Settings: the Rank Tracking domain the phrases are compared with. */
export function RankLinkSettings({ projectId }: { projectId: string }) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const month = new Date().toISOString().slice(0, 7);
  const comparison = useQuery({
    queryKey: ["gscTrackerRank", siteId, month],
    queryFn: () =>
      getGscTrackerRankComparison({ data: { projectId, siteId, month } }),
  });
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (link: {
      configId: string | null;
      device?: "mobile" | "desktop";
    }) => saveGscTrackerRankLink({ data: { projectId, siteId, ...link } }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerRank", siteId],
      }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't save the link")),
  });
  const data = comparison.data;
  const items = [
    { value: "none", label: "Not linked" },
    ...(data?.configs ?? []).map((config) => ({
      value: config.id,
      label: `${config.domain}${config.locationName ? ` · ${config.locationName}` : ""} · ${config.languageCode}${config.id === data?.suggested ? " (matches)" : ""}`,
    })),
  ];
  return (
    <div className="space-y-1">
      <div className="text-sm">Compare with Rank Tracking</div>
      {data && data.configs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This project has no Rank Tracking domain yet. Add one in Rank Tracking
          to compare its positions here.
        </p>
      ) : (
        <>
          <Select
            items={items}
            value={data?.link?.configId ?? "none"}
            onValueChange={(value: string | null) =>
              save.mutate({
                configId: !value || value === "none" ? null : value,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label="Rank Tracking domain"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.link?.devices === "both" ? (
            <SegmentedToggle
              showLabels
              value={data.link.device}
              onChange={(device) =>
                save.mutate({ configId: data.link?.configId ?? null, device })
              }
              items={DEVICES}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Followed phrases show the domain&apos;s Rank Tracking position under
            Search Console&apos;s, marked by how well they agree.
          </p>
        </>
      )}
    </div>
  );
}
