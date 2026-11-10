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

/**
 * Follows a query in the tracker with this page as its target. Shows
 * "Tracked" when it already is, and offers to switch the target when the
 * query is followed with another page.
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
  const queryClient = useQueryClient();
  const targets = useQuery({
    queryKey: ["gscTrackerTargets", projectId],
    queryFn: () => listGscTrackerTargets({ data: { projectId } }),
  });
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      addGscTrackerKeywords({
        data: { projectId, entries: [{ query, targetUrl: url }] },
      }),
    onSuccess: () => {
      toast.success(`Tracking “${query}” on ${url}`);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerTargets", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", projectId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const followed = targets.data?.find(
    (target) => target.query === normalizeQuery(query),
  );
  if (followed && comparableUrl(followed.targetUrl) === comparableUrl(url))
    return <Badge variant="success">Tracked</Badge>;
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={targets.isPending}
      pending={add.isPending}
      onClick={() => add.mutate()}
      title={
        followed
          ? `Tracked with ${followed.targetUrl}; make this page the target instead`
          : undefined
      }
    >
      {add.isPending ? null : <Plus className="size-3" />}
      {followed ? "Set as target" : "Add to tracker"}
    </Button>
  );
}
