import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Crosshair } from "lucide-react";
import { toast } from "sonner";
import { TableBulkActionButton } from "@/client/components/table/TableBulkActionBar";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addGscTrackerKeywords,
  getGscTrackerSites,
} from "@/serverFunctions/gscTracker";

/**
 * Bulk action for query lists: follows each selected query in GSC Tracker,
 * with the page it ranks with as its target URL, on the tracked site for
 * the project's connected property. Shown only to members who manage
 * integrations, where the tracker is available.
 */
export function TrackInGscButton({
  projectId,
  entries,
  onAdded,
}: {
  projectId: string;
  /** The selected queries, each with the page it ranks with. */
  entries: { query: string; targetUrl: string }[];
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sites = useQuery({
    queryKey: ["gscTrackerSites", projectId],
    queryFn: () => getGscTrackerSites({ data: { projectId } }),
  });
  // GSC Insights shows the project's connected property; its queries go to
  // the tracked site for that property.
  const site = sites.data?.sites.find(
    (item) => item.siteUrl === sites.data?.projectSiteUrl,
  );
  const openSite = (siteId: string) =>
    void navigate({
      to: "/p/$projectId/gsc-tracker/$siteId",
      params: { projectId, siteId },
      search: { tab: "keywords", days: 28 },
    });
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: (siteId: string) =>
      addGscTrackerKeywords({
        data: {
          projectId,
          siteId,
          entries: entries.filter((entry) => entry.query.trim().length <= 500),
        },
      }),
    onSuccess: (result, siteId) => {
      toast.success(
        `Following ${result.added} phrase${result.added === 1 ? "" : "s"} in GSC Tracker${
          result.skipped > 0 ? ` (${result.skipped} already followed)` : ""
        }`,
        { action: { label: "Open", onClick: () => openSite(siteId) } },
      );
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", siteId],
      });
      onAdded();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Couldn't add these to GSC Tracker"),
      ),
  });
  if (!sites.data?.available || !sites.data.canManage) return null;
  return (
    <TableBulkActionButton
      icon={<Crosshair className="size-3.5" />}
      disabled={add.isPending || entries.length === 0}
      onClick={() => {
        if (!site) {
          toast.info(
            `Add ${sites.data?.projectSiteUrl ?? "this property"} to GSC Tracker first to follow phrases there.`,
            {
              action: {
                label: "Open GSC Tracker",
                onClick: () =>
                  void navigate({
                    to: "/p/$projectId/gsc-tracker",
                    params: { projectId },
                  }),
              },
            },
          );
          return;
        }
        add.mutate(site.id);
      }}
    >
      Track in GSC
    </TableBulkActionButton>
  );
}
