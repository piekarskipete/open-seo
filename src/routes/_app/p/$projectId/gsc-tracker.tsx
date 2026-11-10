import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";
import { GscTrackerPage } from "@/client/features/gsc-tracker/GscTrackerPage";
import { pageHead } from "@/client/lib/pageHead";
import { GSC_TRACKER_RANGE_DAYS, GSC_TRACKER_TABS } from "@/shared/gsc-tracker";

const searchSchema = z.object({
  tab: z.enum(GSC_TRACKER_TABS).catch("overview"),
  days: z
    .union(GSC_TRACKER_RANGE_DAYS.map((days) => z.literal(days)))
    .catch(28),
});

export const Route = createFileRoute("/_app/p/$projectId/gsc-tracker")({
  head: () => pageHead("GSC Tracker"),
  validateSearch: searchSchema,
  search: {
    middlewares: [stripSearchParams({ tab: "overview", days: 28 })],
  },
  component: GscTrackerRoute,
});

function GscTrackerRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <GscTrackerPage
      projectId={projectId}
      tab={search.tab}
      days={search.days}
      onChange={(update) => {
        void navigate({
          search: (prev) => ({ ...prev, ...update }),
          replace: true,
        });
      }}
    />
  );
}
