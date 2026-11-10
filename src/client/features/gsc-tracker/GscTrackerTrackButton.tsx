import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addGscTrackerKeywords,
  listGscTrackerTargets,
} from "@/serverFunctions/gscTracker";
import { comparableUrl, normalizeQuery } from "@/shared/gsc-tracker";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";

/**
 * Follows a query in the tracker with this page as its target. The same
 * query can be followed for several pages, each its own entry; a page
 * already followed for the query shows "Tracked".
 */
export function TrackPageButton({
  projectId,
  query,
  url,
}: {
  projectId: string;
  query: string;
  url: string;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const targets = useQuery({
    queryKey: ["gscTrackerTargets", siteId],
    queryFn: () => listGscTrackerTargets({ data: { projectId, siteId } }),
  });
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      addGscTrackerKeywords({
        data: { projectId, siteId, entries: [{ query, targetUrl: url }] },
      }),
    onSuccess: () => {
      toast.success(`Tracking “${query}” on ${url}`);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerTargets", siteId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", siteId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const tracked = targets.data?.some(
    (target) =>
      target.query === normalizeQuery(query) &&
      comparableUrl(target.targetUrl) === comparableUrl(url),
  );
  if (tracked) return <Badge variant="success">Tracked</Badge>;
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={targets.isPending}
      pending={add.isPending}
      onClick={() => add.mutate()}
    >
      {add.isPending ? null : <Plus className="size-3" />}
      Add to tracker
    </Button>
  );
}
