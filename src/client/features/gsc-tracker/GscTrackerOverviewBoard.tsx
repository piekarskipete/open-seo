import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  LayoutDashboard,
  Plus,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { EmptyState } from "@/client/components/EmptyState";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { OverviewWidget } from "@/client/features/gsc-tracker/GscTrackerOverviewWidgets";
import {
  WIDGET_KINDS,
  widgetLabel,
  type WidgetOpen,
} from "@/client/features/gsc-tracker/gscTrackerOverviewView";
import { useTags } from "@/client/features/gsc-tracker/gscTrackerTags";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { saveGscTrackerOverviewLayout } from "@/serverFunctions/gscTracker";
import { listGscTrackerGroups } from "@/serverFunctions/gscTrackerGroups";
import {
  DEFAULT_GSC_TRACKER_WIDGETS,
  GSC_TRACKER_MAX_WIDGETS,
  type GscTrackerRangeDays,
  type GscTrackerWidget,
  type GscTrackerWidgetType,
} from "@/shared/gsc-tracker";

/**
 * The Overview tab: the site's chosen widgets in a two-column grid. Members
 * who manage the site can add widgets (a tag's phrases, one page group, …),
 * order them, size them and remove them.
 */
export function OverviewBoard({
  projectId,
  days,
  canManage,
  layout,
  onOpen,
}: {
  projectId: string;
  days: GscTrackerRangeDays;
  canManage: boolean;
  layout: GscTrackerWidget[];
  onOpen: WidgetOpen;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<GscTrackerWidget[] | null>(null);
  const [adding, setAdding] = useState(false);
  const tags = useTags(projectId, siteId);
  const groups = useQuery({
    queryKey: ["gscTrackerGroups", siteId, days],
    queryFn: () => listGscTrackerGroups({ data: { projectId, siteId, days } }),
    enabled: draft !== null,
  });
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: (widgets: GscTrackerWidget[]) =>
      saveGscTrackerOverviewLayout({ data: { projectId, siteId, widgets } }),
    onSuccess: () => {
      toast.success("Overview saved");
      setDraft(null);
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerStatus", siteId],
      });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Couldn't save the layout")),
  });
  const editing = draft !== null;
  const widgets = draft ?? layout;
  const names = {
    tags: tags.data ?? [],
    groups: groups.data?.groups ?? [],
  };
  const move = (index: number, by: number) =>
    setDraft((current) => {
      if (!current) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });
  const update = (index: number, change: Partial<GscTrackerWidget> | null) =>
    setDraft((current) =>
      current
        ? current.flatMap((item, i) =>
            i !== index ? [item] : change ? [{ ...item, ...change }] : [],
          )
        : current,
    );

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <>
              <span className="mr-auto text-xs text-muted-foreground">
                Add, order, size or remove widgets, then save.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(DEFAULT_GSC_TRACKER_WIDGETS)}
              >
                <RotateCcw data-icon="inline-start" />
                Default layout
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={widgets.length >= GSC_TRACKER_MAX_WIDGETS}
                onClick={() => setAdding(true)}
              >
                <Plus data-icon="inline-start" />
                Add widget
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                pending={save.isPending}
                onClick={() => save.mutate(widgets)}
              >
                Save layout
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft(layout)}
            >
              <LayoutDashboard data-icon="inline-start" />
              Customize
            </Button>
          )}
        </div>
      ) : null}
      {widgets.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No widgets"
          description="Customize the Overview to add the summaries you follow."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {widgets.map((widget, index) => (
            <div
              key={widget.id}
              className={cn(
                "min-w-0 space-y-1",
                widget.size === "full" && "lg:col-span-2",
                editing && "rounded-lg ring-1 ring-dashed ring-primary/40 p-1",
              )}
            >
              {editing ? (
                <div className="flex items-center gap-1 px-1">
                  <span className="mr-auto truncate text-xs font-medium">
                    {widgetLabel(widget, names)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={index === widgets.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={
                      widget.size === "full" ? "Half width" : "Full width"
                    }
                    title={widget.size === "full" ? "Half width" : "Full width"}
                    onClick={() =>
                      update(index, {
                        size: widget.size === "full" ? "half" : "full",
                      })
                    }
                  >
                    {widget.size === "full" ? <Columns2 /> : <Square />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove widget"
                    className="hover:text-destructive"
                    onClick={() => update(index, null)}
                  >
                    <X />
                  </Button>
                </div>
              ) : null}
              <OverviewWidget
                widget={widget}
                projectId={projectId}
                days={days}
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <AddWidgetDialog
          tags={names.tags}
          groups={names.groups}
          onAdd={(widget) => {
            setDraft((current) => [...(current ?? layout), widget]);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function AddWidgetDialog({
  tags,
  groups,
  onAdd,
  onClose,
}: {
  tags: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  onAdd: (widget: GscTrackerWidget) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<GscTrackerWidgetType>("keywords");
  // For phrases: a tag, or "" for every phrase. For a group: its id.
  const [choice, setChoice] = useState("");
  const kind = WIDGET_KINDS.find((item) => item.value === type);
  const options =
    type === "keywords"
      ? [{ id: "", name: "All followed phrases" }, ...tags]
      : type === "group"
        ? groups
        : [];
  const ready = type !== "group" || choice !== "";
  const pick = (
    value: string,
    active: boolean,
    label: string,
    onClick: () => void,
  ) => (
    <button
      key={value}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm transition-colors",
        active ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>{kind?.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 sm:grid-cols-2">
          {WIDGET_KINDS.map((item) =>
            pick(item.value, item.value === type, item.label, () => {
              setType(item.value);
              setChoice("");
            }),
          )}
        </div>
        {options.length > 0 || type === "group" ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {type === "keywords" ? "Phrases" : "Page group"}
            </p>
            {type === "group" && groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No page groups yet: create one on the Pages tab.
              </p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {options.map((option) =>
                  pick(
                    option.id || "all",
                    choice === option.id,
                    type === "keywords" && option.id
                      ? `Tagged “${option.name}”`
                      : option.name,
                    () => setChoice(option.id),
                  ),
                )}
              </div>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              onAdd({
                id: crypto.randomUUID(),
                type,
                size: type === "totals" ? "full" : "half",
                ...(type === "keywords" && choice ? { tagId: choice } : {}),
                ...(type === "group" ? { groupId: choice } : {}),
              })
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
