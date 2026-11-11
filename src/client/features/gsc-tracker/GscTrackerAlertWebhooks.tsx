import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
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
import { Input } from "@/client/components/ui/input";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  deleteGscTrackerWebhook,
  saveGscTrackerWebhook,
  testGscTrackerWebhook,
  type getGscTrackerAlerts,
} from "@/serverFunctions/gscTrackerAlerts";
import type { GscTrackerWebhookFormat } from "@/shared/gsc-tracker-alerts";

type Alerts = Awaited<ReturnType<typeof getGscTrackerAlerts>>;
type WebhookRow = Alerts["webhooks"][number];

const FORMATS = [
  { value: "json" as const, label: "JSON", icon: null },
  { value: "slack" as const, label: "Slack", icon: null },
  { value: "discord" as const, label: "Discord", icon: null },
];
const label = "text-xs font-medium text-muted-foreground";

/** The site's webhooks: where alerts go, with a test button each. */
export function WebhooksSection({
  projectId,
  webhooks,
  canManage,
}: {
  projectId: string;
  webhooks: WebhookRow[];
  canManage: boolean;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<WebhookRow | "new" | null>(null);
  const [removing, setRemoving] = useState<WebhookRow | null>(null);
  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["gscTrackerAlerts", siteId],
    });
  const test = useMutation({
    meta: { errorToast: false },
    mutationFn: (id: string) =>
      testGscTrackerWebhook({ data: { projectId, siteId, id } }),
    onSuccess: (result) => {
      if (result.ok)
        toast.success(`Test sent: the webhook answered ${result.status}`);
      else toast.error(result.error ?? "The test didn't go through");
      refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteGscTrackerWebhook({ data: { projectId, siteId, id } }),
    onSuccess: () => {
      toast.success("Webhook deleted with its rules");
      setRemoving(null);
      refresh();
    },
  });
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Webhooks</h2>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            Add webhook
          </Button>
        ) : null}
      </div>
      {webhooks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Webhook className="mr-1 inline size-4" />
          Add a webhook first: any URL that accepts a POST, such as an n8n or
          Make workflow, or a Slack or Discord incoming webhook.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {webhooks.map((webhook) => (
            <li
              key={webhook.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  {webhook.name}
                  <Badge variant="secondary">{webhook.format}</Badge>
                  {webhook.hasSecret ? (
                    <Badge variant="info">signed</Badge>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {webhook.url}
                </p>
                <p className="text-xs text-muted-foreground">
                  {webhook.lastError ? (
                    <span className="text-destructive">
                      {webhook.lastError}
                    </span>
                  ) : webhook.lastSentAt ? (
                    `Last sent ${new Date(webhook.lastSentAt).toLocaleString("en-US")} (${webhook.lastStatus})`
                  ) : (
                    "Nothing sent yet"
                  )}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    pending={test.isPending && test.variables === webhook.id}
                    onClick={() => test.mutate(webhook.id)}
                  >
                    <Send data-icon="inline-start" />
                    Send test
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Edit ${webhook.name}`}
                    onClick={() => setEditing(webhook)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="hover:text-destructive"
                    aria-label={`Delete ${webhook.name}`}
                    onClick={() => setRemoving(webhook)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <WebhookDialog
          projectId={projectId}
          webhook={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          confirmLabel="Delete webhook"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onClose={() => setRemoving(null)}
        >
          Its alert rules and their history go with it.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function WebhookDialog({
  projectId,
  webhook,
  onDone,
  onClose,
}: {
  projectId: string;
  webhook: WebhookRow | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [secret, setSecret] = useState("");
  const [format, setFormat] = useState<GscTrackerWebhookFormat>(
    webhook?.format === "slack" || webhook?.format === "discord"
      ? webhook.format
      : "json",
  );
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      saveGscTrackerWebhook({
        data: {
          projectId,
          siteId,
          id: webhook?.id,
          name,
          url,
          // Left empty while editing, the current secret stays.
          ...(secret || !webhook ? { secret } : {}),
          format,
          mode: "digest",
        },
      }),
    onSuccess: () => {
      toast.success(webhook ? "Webhook saved" : "Webhook added");
      onDone();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {webhook ? "Edit webhook" : "Add a webhook"}
          </DialogTitle>
          <DialogDescription>
            Each check POSTs one summary here: new alerts by type, a line each
            with its URL. With a secret, each request carries an
            X-GSC-Tracker-Signature header: sha256= and the HMAC-SHA256 of the
            body.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className={label}>Name</span>
            <Input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="n8n alerts"
            />
          </label>
          <label className="block space-y-1">
            <span className={label}>URL</span>
            <Input
              value={url}
              maxLength={2048}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhook/gsc-tracker"
            />
          </label>
          <label className="block space-y-1">
            <span className={label}>
              Secret (optional
              {webhook?.hasSecret
                ? "; leave empty to keep the current one"
                : ""}
              )
            </span>
            <Input
              type="password"
              value={secret}
              maxLength={200}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <div className="space-y-1">
            <span className={label}>Format</span>
            <SegmentedToggle
              showLabels
              value={format}
              onChange={setFormat}
              items={FORMATS}
            />
          </div>
        </div>
        {save.error ? (
          <p role="alert" className="text-sm text-destructive">
            {getStandardErrorMessage(save.error)}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            pending={save.isPending}
            disabled={!url.trim()}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
