import { useQuery } from "@tanstack/react-query";
import { Delta } from "@/client/features/gsc-tracker/GscTrackerParts";
import {
  GroupWidget,
  TotalsWidget,
} from "@/client/features/gsc-tracker/GscTrackerTotalsWidgets";
import {
  ClicksChange,
  Figures,
  TopList,
  ViewCounts,
  Widget,
} from "@/client/features/gsc-tracker/GscTrackerWidgetParts";
import {
  applyPageView,
  EMPTY_PAGE_FILTER,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import {
  byClickGain,
  type WidgetOpen,
} from "@/client/features/gsc-tracker/gscTrackerOverviewView";
import { useTags } from "@/client/features/gsc-tracker/gscTrackerTags";
import {
  integer,
  useFormatMetric,
  useSiteId,
} from "@/client/features/gsc-tracker/gscTrackerView";
import {
  getGscTrackerCannibalization,
  getGscTrackerKeywords,
  getGscTrackerList,
} from "@/serverFunctions/gscTracker";
import {
  listGscTrackerGroups,
  listGscTrackerPages,
} from "@/serverFunctions/gscTrackerGroups";
import type {
  GscTrackerRangeDays,
  GscTrackerWidget,
} from "@/shared/gsc-tracker";

const count = (value: number) => integer.format(value);

/** Positions gained from a phrase's start to its latest day. */
function gainSinceStart(item: {
  start: { position: number } | null;
  latest: { position: number } | null;
}): number | null {
  return item.start && item.latest
    ? item.start.position - item.latest.position
    : null;
}

/** One Overview widget, by its type. */
export function OverviewWidget({
  widget,
  projectId,
  days,
  onOpen,
}: {
  widget: GscTrackerWidget;
  projectId: string;
  days: GscTrackerRangeDays;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const tags = useTags(projectId, siteId);
  switch (widget.type) {
    case "totals":
      return <TotalsWidget projectId={projectId} days={days} />;
    case "keywords": {
      const tag = widget.tagId
        ? (tags.data?.find((item) => item.id === widget.tagId) ?? {
            id: widget.tagId,
            name: "a removed tag",
          })
        : null;
      return <KeywordsWidget projectId={projectId} tag={tag} onOpen={onOpen} />;
    }
    case "queries":
      return (
        <QueriesWidget projectId={projectId} days={days} onOpen={onOpen} />
      );
    case "pages":
      return <PagesWidget projectId={projectId} days={days} onOpen={onOpen} />;
    case "group":
      return widget.groupId ? (
        <GroupWidget
          projectId={projectId}
          days={days}
          groupId={widget.groupId}
          onOpen={onOpen}
        />
      ) : null;
    case "cannibalization":
      return (
        <CannibalizationWidget
          projectId={projectId}
          days={days}
          onOpen={onOpen}
        />
      );
  }
}

function KeywordsWidget({
  projectId,
  tag,
  onOpen,
}: {
  projectId: string;
  /** Only the phrases carrying this tag. */
  tag: { id: string; name: string } | null;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const formatMetric = useFormatMetric();
  // The same month the Keywords tab opens on.
  const month = new Date().toISOString().slice(0, 7);
  const keywords = useQuery({
    queryKey: ["gscTrackerKeywords", siteId, month],
    queryFn: () =>
      getGscTrackerKeywords({ data: { projectId, siteId, month } }),
  });
  const list = (keywords.data?.keywords ?? []).filter(
    (item) => !tag || item.tagIds.includes(tag.id),
  );
  const gain = gainSinceStart;
  const measured = list.filter((item) => gain(item) !== null);
  const latest = list.flatMap((item) =>
    item.latest ? [item.latest.position] : [],
  );
  const movers = [...measured];
  movers.sort((a, b) => Math.abs(gain(b) ?? 0) - Math.abs(gain(a) ?? 0));
  return (
    <Widget
      title={tag ? `Phrases tagged “${tag.name}”` : "Followed phrases"}
      onOpen={() => onOpen("keywords")}
      loading={keywords.isPending}
    >
      <Figures
        items={[
          { label: "Phrases", value: count(list.length) },
          {
            label: "Avg. position",
            value: formatMetric(
              "position",
              latest.length > 0
                ? latest.reduce((sum, value) => sum + value, 0) / latest.length
                : null,
            ),
          },
          {
            label: "Up since start",
            value: count(
              measured.filter((item) => (gain(item) ?? 0) >= 1).length,
            ),
            tone: "good",
          },
          {
            label: "Down since start",
            value: count(
              measured.filter((item) => (gain(item) ?? 0) <= -1).length,
            ),
            tone: "bad",
          },
        ]}
      />
      <TopList
        title="Biggest moves since start"
        empty="No phrase has a start and a latest position yet."
        rows={movers.slice(0, 4).map((item) => ({
          key: item.id,
          label: item.query,
          value: (
            <>
              {formatMetric("position", item.latest?.position ?? null)}{" "}
              <Delta
                metric="position"
                current={item.latest?.position ?? null}
                previous={item.start?.position ?? null}
              />
            </>
          ),
        }))}
      />
      {list.some((item) => item.cannibalized) ? (
        <p className="text-xs text-muted-foreground">
          {count(list.filter((item) => item.cannibalized).length)} phrase(s)
          with another page beating the target this month.
        </p>
      ) : null}
    </Widget>
  );
}

function QueriesWidget({
  projectId,
  days,
  onOpen,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  // The Query Explorer's unfiltered list.
  const list = useQuery({
    queryKey: ["gscTrackerList", siteId, days, "", ""],
    queryFn: () => getGscTrackerList({ data: { projectId, siteId, days } }),
  });
  const rows = list.data?.rows ?? [];
  const gainers = byClickGain(rows).filter(
    (row) => row.current.clicks > row.previous.clicks,
  );
  return (
    <Widget
      title="Queries"
      onOpen={() => onOpen("explorer")}
      loading={list.isPending}
    >
      <ViewCounts rows={rows} />
      <TopList
        title="Most clicks gained"
        empty="No query gained clicks in this period."
        rows={gainers.slice(0, 4).map((row) => ({
          key: row.key,
          label: row.key,
          value: <ClicksChange row={row} />,
        }))}
      />
    </Widget>
  );
}

function PagesWidget({
  projectId,
  days,
  onOpen,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const groups = useQuery({
    queryKey: ["gscTrackerGroups", siteId, days],
    queryFn: () => listGscTrackerGroups({ data: { projectId, siteId, days } }),
  });
  // The Page Groups tab's unfiltered page list.
  const pages = useQuery({
    queryKey: ["gscTrackerPages", siteId, null, days, EMPTY_PAGE_FILTER],
    queryFn: () =>
      listGscTrackerPages({
        data: { projectId, siteId, days, urlMode: "contains" },
      }),
  });
  const rows = pages.data?.rows ?? [];
  const groupRows = [...(groups.data?.groups ?? [])];
  groupRows.sort((a, b) => b.current.clicks - a.current.clicks);
  const gainers = byClickGain(applyPageView(rows, "all")).filter(
    (row) => row.current.clicks > row.previous.clicks,
  );
  return (
    <Widget
      title="Pages and groups"
      onOpen={() => onOpen("pages")}
      loading={groups.isPending || pages.isPending}
    >
      <ViewCounts rows={rows} />
      <TopList
        title="Groups by clicks"
        empty="No page groups yet."
        rows={groupRows.slice(0, 4).map((group) => ({
          key: group.id,
          label: `${group.name} (${count(group.urls)} URLs)`,
          value: <ClicksChange row={{ key: group.id, ...group }} />,
          onClick: () => onOpen("pages", group.id),
        }))}
      />
      <TopList
        title="Pages with most clicks gained"
        empty="No page gained clicks in this period."
        rows={gainers.slice(0, 3).map((row) => ({
          key: row.key,
          label: row.key,
          value: <ClicksChange row={row} />,
        }))}
      />
    </Widget>
  );
}

function CannibalizationWidget({
  projectId,
  days,
  onOpen,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const formatMetric = useFormatMetric();
  // The Cannibalization tab's unfiltered list.
  const result = useQuery({
    queryKey: ["gscTrackerCannibalization", siteId, days, "", ""],
    queryFn: () =>
      getGscTrackerCannibalization({ data: { projectId, siteId, days } }),
  });
  const queries = result.data?.queries ?? [];
  return (
    <Widget
      title="Competing pages"
      onOpen={() => onOpen("cannibalization")}
      loading={result.isPending}
    >
      <Figures
        items={[
          {
            label: "Queries split",
            value: count(queries.length),
            tone: queries.length > 0 ? "bad" : undefined,
          },
          {
            label: "Their impressions",
            value: formatMetric(
              "impressions",
              queries.reduce((sum, item) => sum + item.impressions, 0),
            ),
          },
          {
            label: "Their clicks",
            value: formatMetric(
              "clicks",
              queries.reduce((sum, item) => sum + item.clicks, 0),
            ),
          },
        ]}
      />
      <TopList
        title="Biggest splits"
        empty="No query splits its impressions between your pages."
        rows={queries.slice(0, 4).map((item) => ({
          key: item.query,
          label: item.query,
          value: `${item.pages.length} pages · ${formatMetric("impressions", item.impressions)}`,
        }))}
      />
    </Widget>
  );
}
