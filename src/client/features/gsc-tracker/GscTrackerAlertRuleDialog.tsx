import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Switch } from "@/client/components/ui/switch";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { saveGscTrackerAlertRule } from "@/serverFunctions/gscTrackerAlerts";
import {
  alertParams,
  GSC_TRACKER_ALERT_DEFINITIONS,
  GSC_TRACKER_ALERT_TYPES,
  type GscTrackerAlertParams,
  type GscTrackerAlertType,
} from "@/shared/gsc-tracker-alerts";

const label = "text-xs font-medium text-muted-foreground";

type Option = { id: string; name: string };

/** A rule being edited, or a new one's starting point. */
export type RuleDraft = {
  id?: string;
  type: GscTrackerAlertType;
  webhookId: string;
  params: GscTrackerAlertParams;
  active: boolean;
  cooldownDays: number;
};

function OptionSelect({
  value,
  options,
  noneLabel,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  noneLabel?: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const items = [
    ...(noneLabel ? [{ value: "", label: noneLabel }] : []),
    ...options.map((option) => ({ value: option.id, label: option.name })),
  ];
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next: string | null) => onChange(next ?? "")}
    >
      <SelectTrigger size="sm" className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value || "none"} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Adds or edits a rule: its type (new rules only), thresholds, scope,
 *  webhook and cooldown. */
export function AlertRuleDialog({
  projectId,
  initial,
  webhooks,
  tags,
  groups,
  onDone,
  onClose,
}: {
  projectId: string;
  initial: RuleDraft;
  webhooks: Option[];
  tags: Option[];
  groups: Option[];
  onDone: () => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const definition = GSC_TRACKER_ALERT_DEFINITIONS[draft.type];
  const params = alertParams(draft.type, draft.params);
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      saveGscTrackerAlertRule({
        data: { projectId, siteId, ...draft, params },
      }),
    onSuccess: () => {
      toast.success(draft.id ? "Rule saved" : "Rule added");
      onDone();
    },
  });
  const pickType = (type: GscTrackerAlertType) =>
    setDraft((current) => ({
      ...current,
      type,
      params: {},
      cooldownDays: GSC_TRACKER_ALERT_DEFINITIONS[type].cooldownDays,
    }));
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? "Edit alert rule" : "Add an alert rule"}
          </DialogTitle>
          <DialogDescription>{definition.description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {draft.id ? null : (
            <div className="grid gap-1 sm:grid-cols-2">
              {GSC_TRACKER_ALERT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={draft.type === type}
                  onClick={() => pickType(type)}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-sm transition-colors",
                    draft.type === type
                      ? "bg-primary/10 ring-1 ring-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {GSC_TRACKER_ALERT_DEFINITIONS[type].label}
                </button>
              ))}
            </div>
          )}
          {definition.params.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {definition.params.map((param) => (
                <label key={param.key} className="block space-y-1">
                  <span className={label}>{param.label}</span>
                  <Input
                    type="number"
                    min={param.min}
                    max={param.max}
                    value={params[param.key] ?? param.default}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        params: {
                          ...current.params,
                          [param.key]: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : null}
          {definition.scope === "phrases" ? (
            <div className="space-y-1">
              <span className={label}>Phrases</span>
              <OptionSelect
                ariaLabel="Phrases"
                value={draft.params.tagId ?? ""}
                options={tags.map((tag) => ({
                  id: tag.id,
                  name: `Tagged “${tag.name}”`,
                }))}
                noneLabel="All followed phrases"
                onChange={(tagId) =>
                  setDraft((current) => ({
                    ...current,
                    params: { ...current.params, tagId: tagId || undefined },
                  }))
                }
              />
            </div>
          ) : definition.scope === "groups" ? (
            <div className="space-y-1">
              <span className={label}>Page groups</span>
              <OptionSelect
                ariaLabel="Page groups"
                value={draft.params.groupId ?? ""}
                options={groups}
                noneLabel="All page groups"
                onChange={(groupId) =>
                  setDraft((current) => ({
                    ...current,
                    params: {
                      ...current.params,
                      groupId: groupId || undefined,
                    },
                  }))
                }
              />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className={label}>Send to</span>
              <OptionSelect
                ariaLabel="Webhook"
                value={draft.webhookId}
                options={webhooks}
                onChange={(webhookId) =>
                  setDraft((current) => ({ ...current, webhookId }))
                }
              />
            </div>
            <label className="block space-y-1">
              <span className={label}>
                Quiet days before alerting about the same thing again
              </span>
              <Input
                type="number"
                min={0}
                max={90}
                value={draft.cooldownDays}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    cooldownDays: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.active}
              onCheckedChange={(active) =>
                setDraft((current) => ({ ...current, active }))
              }
            />
            Active
          </label>
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
            disabled={!draft.webhookId}
            onClick={() => save.mutate()}
          >
            Save rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
