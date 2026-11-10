import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { listGscSites } from "@/serverFunctions/gsc";
import { addGscTrackerSite } from "@/serverFunctions/gscTracker";

/** A property to track: through an account, or the project's connection. */
type Choice = { siteUrl: string; accountId: string | null };

/**
 * Picks a Search Console property to track: any verified property of the
 * member's Google accounts and the organization's service accounts, or the
 * project's own connection.
 */
export function AddSiteDialog({
  projectId,
  projectSiteUrl,
  trackedSiteUrls,
  onClose,
}: {
  projectId: string;
  /** The property the project's Search Console connection points at. */
  projectSiteUrl: string | null;
  trackedSiteUrls: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);
  const tracked = new Set(trackedSiteUrls);
  const accounts = useQuery({
    queryKey: ["gscSites", projectId],
    queryFn: () => listGscSites({ data: { projectId } }),
  });
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: (picked: Choice) =>
      addGscTrackerSite({
        data: picked.accountId
          ? { projectId, siteUrl: picked.siteUrl, accountId: picked.accountId }
          : { projectId },
      }),
    onSuccess: (result) => {
      toast.success("Site added; recent days are in, older ones follow");
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerSites", projectId],
      });
      void navigate({
        to: "/p/$projectId/gsc-tracker/$siteId",
        params: { projectId, siteId: result.id },
        search: { tab: "keywords", days: 28 },
      });
    },
  });

  const option = (
    key: string,
    picked: Choice,
    label: string,
    disabledReason: string | null,
  ) => {
    const selected =
      choice?.siteUrl === picked.siteUrl &&
      choice.accountId === picked.accountId;
    return (
      <button
        key={key}
        type="button"
        disabled={disabledReason !== null}
        onClick={() => setChoice(picked)}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
          selected ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
          disabledReason ? "cursor-not-allowed opacity-50" : null,
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {disabledReason ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {disabledReason}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
          <DialogDescription>
            Pick a Search Console property. Its history loads in the background
            (up to 16 months), through the account you pick it from.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 space-y-3 overflow-y-auto">
          {projectSiteUrl ? (
            <section className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                This project&apos;s Search Console connection
              </p>
              {option(
                "project",
                { siteUrl: projectSiteUrl, accountId: null },
                projectSiteUrl,
                tracked.has(projectSiteUrl) ? "Tracked" : null,
              )}
            </section>
          ) : null}
          {accounts.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : accounts.isError ? (
            <QueryError
              error={accounts.error}
              fallback="Couldn't list your Search Console properties."
              onRetry={() => void accounts.refetch()}
              isRetrying={accounts.isFetching}
            />
          ) : (
            accounts.data.accounts.map((account) => (
              <section key={account.accountId} className="space-y-1">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {account.email ?? "Google account"}
                  {account.kind === "service_account" ? (
                    <Badge variant="secondary">Service account</Badge>
                  ) : null}
                </p>
                {account.requiresReconnect ? (
                  <p className="px-3 text-xs text-destructive">
                    This account needs reconnecting in Integrations.
                  </p>
                ) : account.sites.length === 0 ? (
                  <p className="px-3 text-xs text-muted-foreground">
                    No properties on this account.
                  </p>
                ) : (
                  account.sites.map((site) =>
                    option(
                      `${account.accountId}:${site.siteUrl}`,
                      { siteUrl: site.siteUrl, accountId: account.accountId },
                      site.siteUrl,
                      tracked.has(site.siteUrl)
                        ? "Tracked"
                        : site.selectable
                          ? null
                          : "Not verified",
                    ),
                  )
                )}
              </section>
            ))
          )}
          {!projectSiteUrl &&
          accounts.data &&
          accounts.data.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Connect a Google account or add a service account key in
              Integrations to see your Search Console properties here.
            </p>
          ) : null}
        </div>
        {add.error ? (
          <p role="alert" className="text-sm text-destructive">
            {getStandardErrorMessage(add.error)}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!choice}
            pending={add.isPending}
            onClick={() => choice && add.mutate(choice)}
          >
            Add site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
