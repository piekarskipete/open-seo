import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { BackLink, PageHeader } from "@/client/components/PageHeader";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/p/$projectId/gsc-tracker")({
  head: () => pageHead("GSC Tracker"),
  component: GscTrackerLayout,
});

function GscTrackerLayout() {
  // Only a site's page has a site id, and only it links back.
  const { projectId, siteId } = useParams({ strict: false });
  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="GSC Tracker"
          description="Follow phrases day by day on the URL that should rank, and keep up to 16 months of Search Console history per site."
          backLink={
            projectId && siteId ? (
              <BackLink to="/p/$projectId/gsc-tracker" params={{ projectId }}>
                Tracked sites
              </BackLink>
            ) : undefined
          }
        />
        <Outlet />
      </div>
    </div>
  );
}
