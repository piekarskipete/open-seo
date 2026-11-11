import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, Pencil, Plus, Radar, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Switch } from "@/client/components/ui/switch";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  AlertRuleDialog,
  type RuleDraft,
} from "@/client/features/gsc-tracker/GscTrackerAlertRuleDialog";
import { WebhooksSection } from "@/client/features/gsc-tracker/GscTrackerAlertWebhooks";
import { useTags } from "@/client/features/gsc-tracker/gscTrackerTags";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addGscTrackerRecommendedAlerts,
  deleteGscTrackerAlertRule,
  getGscTrackerAlerts,
  runGscTrackerAlerts,
  saveGscTrackerAlertRule,
} from "@/serverFunctions/gscTrackerAlerts";
import { listGscTrackerGroups } from "@/serverFunctions/gscTrackerGroups";
import {
  GSC_TRACKER_ALERT_DEFINITIONS,
  type GscTrackerAlertParams,
  type GscTrackerAlertType,
} from "@/shared/gsc-tracker-alerts";

type Alerts = Awaited<ReturnType<typeof getGscTrackerAlerts>>;
type Rule = Alerts["rules"][number];

/** A rule's thresholds and scope in a line. */
function ruleSummary(
  type: GscTrackerAlertType,
  params: GscTrackerAlertParams,
  names: { tags: Map<string, string>; groups: Map<string, string> },
) {
  const parts = GSC_TRACKER_ALERT_DEFINITIONS[type].params.map(
    (param) => `${param.label}: ${params[param.key] ?? param.default}`,
  );
  if (params.tagId)
    parts.push(`tag “${names.tags.get(params.tagId) ?? "removed"}”`);
  if (params.groupId)
    parts.push(`group “${names.groups.get(params.groupId) ?? "removed"}”`);
  return parts.join(" · ");
}

/**
 * The site's alerts: webhooks they go to, the rules (thresholds, scope, on
 * or off), and what was sent. Rules run after each sync on the newest
 * settled day; "Check now" runs them at once.
 */
export function AlertsTab({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const alerts = useQuery({
    queryKey: ["gscTrackerAlerts", siteId],
    queryFn: () => getGscTrackerAlerts({ data: { projectId, siteId } }),
  });
  const tags = useTags(projectId, siteId).data ?? [];
  const groups =
    useQuery({
      queryKey: ["gscTrackerGroups", siteId, 28],
      queryFn: () =>
        listGscTrackerGroups({ data: { projectId, siteId, days: 28 } }),
    }).data?.groups ?? [];
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["gscTrackerAlerts", siteId],
    });
  const toggle = useMutation({
    meta: { errorToast: false },
    mutationFn: (rule: Rule) =>
      saveGscTrackerAlertRule({
        data: { projectId, siteId, ...rule, active: !rule.active },
      }),
    onSuccess: refresh,
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteGscTrackerAlertRule({ data: { projectId, siteId, id } }),
    onSuccess: () => {
      toast.success("Rule deleted");
      refresh();
    },
  });
  const recommended = useMutation({
    mutationFn: (webhookId: string) =>
      addGscTrackerRecommendedAlerts({
        data: { projectId, siteId, webhookId },
      }),
    onSuccess: (result) => {
      toast.success(
        result.added > 0
          ? `Added ${result.added} recommended rule${result.added === 1 ? "" : "s"}`
          : "The recommended rules are already there",
      );
      refresh();
    },
  });
  const run = useMutation({
    meta: { errorToast: false },
    mutationFn: () => runGscTrackerAlerts({ data: { projectId, siteId } }),
    onSuccess: (result) => {
      toast.success(
        result.raised > 0
          ? `${result.raised} new alert${result.raised === 1 ? "" : "s"} raised and sent`
          : "Checked: nothing new to alert about",
      );
      refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  if (alerts.isPending) return <Skeleton className="h-80 w-full" />;
  if (alerts.isError)
    return (
      <QueryError
        error={alerts.error}
        fallback="Couldn't load the alerts."
        onRetry={() => void alerts.refetch()}
        isRetrying={alerts.isFetching}
      />
    );
  const data = alerts.data;
  const firstWebhook = data.webhooks[0]?.id ?? "";
  const names = {
    tags: new Map(tags.map((tag) => [tag.id, tag.name])),
    groups: new Map(groups.map((group) => [group.id, group.name])),
  };
  const webhookNames = new Map(
    data.webhooks.map((webhook) => [webhook.id, webhook.name]),
  );
  return (
    <div className="space-y-6">
      <WebhooksSection
        projectId={projectId}
        webhooks={data.webhooks}
        canManage={canManage}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Alert rules</h2>
          {canManage && firstWebhook ? (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                pending={run.isPending}
                onClick={() => run.mutate()}
              >
                <Radar data-icon="inline-start" />
                Check now
              </Button>
              <Button
                size="sm"
                variant="outline"
                pending={recommended.isPending}
                onClick={() => recommended.mutate(firstWebhook)}
              >
                <BellPlus data-icon="inline-start" />
                Add recommended rules
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    type: "phrase_dropped",
                    webhookId: firstWebhook,
                    params: {},
                    active: true,
                    cooldownDays:
                      GSC_TRACKER_ALERT_DEFINITIONS.phrase_dropped.cooldownDays,
                  })
                }
              >
                <Plus data-icon="inline-start" />
                Add rule
              </Button>
            </div>
          ) : null}
        </div>
        {data.rules.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No rules yet.{" "}
            {firstWebhook
              ? "Add the recommended set (a phrase drop, a phrase reaching the top 10, page group and site traffic drops, sync problems) or pick your own."
              : "Add a webhook above to start."}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {data.rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <Switch
                  checked={rule.active}
                  disabled={!canManage || toggle.isPending}
                  aria-label={rule.active ? "Turn off" : "Turn on"}
                  onCheckedChange={() => toggle.mutate(rule)}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {GSC_TRACKER_ALERT_DEFINITIONS[rule.type].label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      ruleSummary(rule.type, rule.params, names),
                      rule.cooldownDays > 0
                        ? `quiet for ${rule.cooldownDays} day${rule.cooldownDays === 1 ? "" : "s"}`
                        : null,
                      `to ${webhookNames.get(rule.webhookId) ?? "?"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit rule"
                      onClick={() => setEditing(rule)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="hover:text-destructive"
                      aria-label="Delete rule"
                      onClick={() => remove.mutate(rule.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Rules run after each sync on the newest settled day (Search Console
          keeps revising the last two). An alert is sent once per rule, subject
          and day, and the quiet days keep the same subject from alerting again
          too soon.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Sent alerts</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead className="text-right">Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((event) => (
                  <TableRow key={event.id} className="align-top">
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {event.date}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs break-words text-muted-foreground">
                        {event.message}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          event.status === "sent"
                            ? "success"
                            : event.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                        title={
                          event.responseStatus
                            ? `Webhook answered ${event.responseStatus}`
                            : `${event.attempts} attempt(s)`
                        }
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </section>

      {editing ? (
        <AlertRuleDialog
          projectId={projectId}
          initial={editing}
          webhooks={data.webhooks.map((webhook) => ({
            id: webhook.id,
            name: webhook.name,
          }))}
          tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          groups={groups.map((group) => ({ id: group.id, name: group.name }))}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
