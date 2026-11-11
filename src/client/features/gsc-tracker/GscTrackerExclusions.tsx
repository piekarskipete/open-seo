import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, X } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { saveGscTrackerCannibalExclusions } from "@/serverFunctions/gscTracker";
import {
  GSC_TRACKER_MAX_EXCLUSIONS,
  type GscTrackerExclusion,
} from "@/shared/gsc-tracker";

const MODES = [
  { value: "contains" as const, label: "Contains", icon: null },
  { value: "regex" as const, label: "Regex", icon: null },
];

/**
 * URLs Cannibalization leaves out, shown as chips: a click turns one off or
 * on, the cross removes it. Members who manage the site add new ones as text
 * a URL contains ("?fbclid=") or a regular expression.
 */
export function ExclusionsBar({
  projectId,
  exclusions,
  canManage,
}: {
  projectId: string;
  exclusions: GscTrackerExclusion[];
  canManage: boolean;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<GscTrackerExclusion["mode"]>("contains");
  const [pattern, setPattern] = useState("");
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (next: GscTrackerExclusion[]) =>
      saveGscTrackerCannibalExclusions({
        data: { projectId, siteId, exclusions: next },
      }),
    onSuccess: () => {
      for (const key of ["gscTrackerCannibalization"])
        void queryClient.invalidateQueries({ queryKey: [key, siteId] });
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(error, "Couldn't save the exclusions"),
      ),
  });
  const add = () => {
    const text = pattern.trim();
    if (!text) return;
    save.mutate(
      [
        ...exclusions,
        { id: crypto.randomUUID(), mode, pattern: text, active: true },
      ],
      {
        onSuccess: () => {
          setPattern("");
          setAdding(false);
        },
      },
    );
  };
  if (exclusions.length === 0 && !canManage) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Ban className="size-3.5" />
          Excluded URLs
        </span>
        {exclusions.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            None: every URL counts.
          </span>
        ) : null}
        {exclusions.map((rule) => (
          <span
            key={rule.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              rule.active
                ? "border-primary/40 bg-primary/10"
                : "border-border text-muted-foreground line-through",
            )}
          >
            <button
              type="button"
              disabled={!canManage || save.isPending}
              title={rule.active ? "Turn off" : "Turn on"}
              onClick={() =>
                save.mutate(
                  exclusions.map((item) =>
                    item.id === rule.id
                      ? { ...item, active: !item.active }
                      : item,
                  ),
                )
              }
            >
              {rule.mode === "regex" ? (
                <span className="font-mono">/{rule.pattern}/</span>
              ) : (
                <>contains “{rule.pattern}”</>
              )}
            </button>
            {canManage ? (
              <button
                type="button"
                aria-label={`Remove ${rule.pattern}`}
                className="text-muted-foreground hover:text-destructive"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(exclusions.filter((item) => item.id !== rule.id))
                }
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        ))}
        {canManage && !adding ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={exclusions.length >= GSC_TRACKER_MAX_EXCLUSIONS}
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" />
            Exclude
          </Button>
        ) : null}
      </div>
      {adding ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <SegmentedToggle
            showLabels
            value={mode}
            onChange={setMode}
            items={MODES}
          />
          <Input
            autoFocus
            value={pattern}
            maxLength={500}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={mode === "regex" ? "[?&]utm_" : "?fbclid="}
            aria-label="URL to exclude"
            className={cn("h-8 max-w-sm", mode === "regex" && "font-mono")}
          />
          <Button
            size="sm"
            type="submit"
            pending={save.isPending}
            disabled={!pattern.trim()}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}
    </div>
  );
}
