import { createFileRoute } from "@tanstack/react-router";
import { GscTrackerSiteList } from "@/client/features/gsc-tracker/GscTrackerSiteList";

export const Route = createFileRoute("/_app/p/$projectId/gsc-tracker/")({
  component: GscTrackerIndex,
});

function GscTrackerIndex() {
  const { projectId } = Route.useParams();
  return <GscTrackerSiteList projectId={projectId} />;
}
