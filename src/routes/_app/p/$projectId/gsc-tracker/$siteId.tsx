import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";
import { GscTrackerSitePage } from "@/client/features/gsc-tracker/GscTrackerPage";
import { GSC_TRACKER_RANGE_DAYS, GSC_TRACKER_TABS } from "@/shared/gsc-tracker";

const searchSchema = z.object({
  tab: z.enum(GSC_TRACKER_TABS).catch("overview"),
  days: z
    .union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days)))
    .catch(28),
  // The open page group on the Page Groups tab.
  group: z.string().min(1).max(100).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/p/$projectId/gsc-tracker/$siteId")({
  validateSearch: searchSchema,
  search: {
    middlewares: [stripSearchParams({ tab: "overview", days: 28 })],
  },
  component: GscTrackerSiteRoute,
});

function GscTrackerSiteRoute() {
  const { projectId, siteId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <GscTrackerSitePage
      key={siteId}
      projectId={projectId}
      siteId={siteId}
      tab={search.tab}
      days={search.days}
      groupId={search.group}
      onChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
