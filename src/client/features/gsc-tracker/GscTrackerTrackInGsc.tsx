import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Crosshair } from "lucide-react";
import { toast } from "sonner";
import { TableBulkActionButton } from "@/client/components/table/TableBulkActionBar";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addGscTrackerKeywords,
  getGscTrackerStatus,
} from "@/serverFunctions/gscTracker";

/**
 * Bulk action for query lists: follows each selected query in GSC Tracker,
 * with the page it ranks with as its target URL. Shown only to members who
 * manage integrations, where the tracker is available.
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
  const status = useQuery({
    queryKey: ["gscTrackerStatus", projectId],
    queryFn: () => getGscTrackerStatus({ data: { projectId } }),
  });
  const openTracker = () =>
    void navigate({
      to: "/p/$projectId/gsc-tracker",
      params: { projectId },
      search: { tab: "keywords", days: 28 },
    });
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      addGscTrackerKeywords({
        data: {
          projectId,
          entries: entries.filter((entry) => entry.query.trim().length <= 500),
        },
      }),
    onSuccess: (result) => {
      toast.success(
        `Following ${result.added} phrase${result.added === 1 ? "" : "s"} in GSC Tracker${
          result.skipped > 0 ? ` (${result.skipped} already followed)` : ""
        }`,
        { action: { label: "Open", onClick: openTracker } },
      );
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
      onAdded();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Couldn't add these to GSC Tracker"),
      ),
  });
  if (!status.data?.available || !status.data.canManage) return null;
  return (
    <TableBulkActionButton
      icon={<Crosshair className="size-3.5" />}
      disabled={add.isPending || entries.length === 0}
      onClick={() => {
        if (!status.data?.enabled) {
          toast.info("Start GSC Tracker first to follow phrases there.", {
            action: { label: "Open GSC Tracker", onClick: openTracker },
          });
          return;
        }
        add.mutate();
      }}
    >
      Track in GSC
    </TableBulkActionButton>
  );
}
