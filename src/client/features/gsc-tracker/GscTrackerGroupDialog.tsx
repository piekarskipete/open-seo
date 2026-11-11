import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
import { SegmentedToggle } from "@/client/components/SegmentedToggle";
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
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  GROUP_KINDS,
  refreshGroups,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";
import {
  addGscTrackerGroupUrls,
  createGscTrackerGroup,
  updateGscTrackerGroup,
} from "@/serverFunctions/gscTrackerGroups";
import {
  GSC_TRACKER_GROUP_NAME_MAX,
  type GscTrackerGroupKind,
} from "@/shared/gsc-tracker";

const fieldLabel = "text-xs font-medium text-muted-foreground";

/** Creates a group, or edits one's name and rule (its kind stays). */
export function GroupFormDialog({
  projectId,
  group,
  onSaved,
  onClose,
}: {
  projectId: string;
  /** The group to edit; without it, a new group. */
  group?: {
    id: string;
    name: string;
    kind: GscTrackerGroupKind;
    pattern: string | null;
  };
  onSaved: (groupId: string) => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [name, setName] = useState(group?.name ?? "");
  const [kind, setKind] = useState<GscTrackerGroupKind>(
    group?.kind ?? "directory",
  );
  const [pattern, setPattern] = useState(group?.pattern ?? "");
  const kindInfo = GROUP_KINDS.find((item) => item.value === kind);
  const save = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      if (group) {
        await updateGscTrackerGroup({
          data: {
            projectId,
            siteId,
            groupId: group.id,
            name,
            ...(kind === "manual" ? {} : { pattern }),
          },
        });
        return group.id;
      }
      const created = await createGscTrackerGroup({
        data: {
          projectId,
          siteId,
          name,
          kind,
          ...(kind === "manual" ? {} : { pattern }),
        },
      });
      return created.id;
    },
    onSuccess: (groupId) => {
      toast.success(group ? "Group saved" : "Group created");
      refreshGroups(queryClient, siteId);
      onSaved(groupId);
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New page group"}</DialogTitle>
          <DialogDescription>
            A group adds up its pages&apos; clicks, impressions, CTR and
            position for every period.
          </DialogDescription>
        </DialogHeader>
        <form
          id="gsc-tracker-group-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="block space-y-1.5">
            <span className={fieldLabel}>Name</span>
            <Input
              autoFocus
              value={name}
              maxLength={GSC_TRACKER_GROUP_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="Blog posts"
            />
          </label>
          {group ? null : (
            <div className="space-y-1.5">
              <span className={fieldLabel}>URLs</span>
              <SegmentedToggle
                showLabels
                value={kind}
                onChange={setKind}
                items={GROUP_KINDS.map((item) => ({
                  value: item.value,
                  label: item.label,
                  icon: null,
                }))}
              />
            </div>
          )}
          {kind === "manual" ? null : (
            <label className="block space-y-1.5">
              <span className={fieldLabel}>
                {kind === "sitemap"
                  ? "Sitemap URL"
                  : kind === "directory"
                    ? "Directory (a path or a full URL)"
                    : "Regular expression"}
              </span>
              <Input
                value={pattern}
                maxLength={2048}
                onChange={(event) => setPattern(event.target.value)}
                placeholder={kindInfo?.placeholder}
                className={cn(kind === "regex" && "font-mono")}
              />
            </label>
          )}
          <p className="text-xs text-muted-foreground">{kindInfo?.hint}</p>
        </form>
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
            type="submit"
            form="gsc-tracker-group-form"
            pending={save.isPending}
            disabled={!name.trim() || (kind !== "manual" && !pattern.trim())}
          >
            {group ? "Save" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Puts the selected URLs into a group, or into a new hand-picked one. */
export function AddToGroupDialog({
  projectId,
  urls,
  groups,
  onDone,
  onClose,
}: {
  projectId: string;
  urls: string[];
  groups: { id: string; name: string }[];
  onDone: () => void;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string>(groups[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: async () => {
      if (target === "new") {
        await createGscTrackerGroup({
          data: { projectId, siteId, name: newName, kind: "manual", urls },
        });
        return newName.trim();
      }
      await addGscTrackerGroupUrls({
        data: { projectId, siteId, groupId: target, urls },
      });
      return groups.find((group) => group.id === target)?.name ?? "the group";
    },
    onSuccess: (name) => {
      toast.success(
        `Added ${urls.length} URL${urls.length === 1 ? "" : "s"} to ${name}`,
      );
      refreshGroups(queryClient, siteId);
      onDone();
    },
  });
  const option = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setTarget(value)}
      aria-pressed={target === value}
      className={cn(
        "flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors",
        target === value
          ? "bg-primary/10 ring-1 ring-primary"
          : "hover:bg-muted",
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add {urls.length} URL{urls.length === 1 ? "" : "s"} to a group
          </DialogTitle>
          <DialogDescription>
            URLs added by hand stay in the group until you remove them.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {groups.map((group) => option(group.id, group.name))}
          {option("new", "New group…")}
        </div>
        {target === "new" ? (
          <Input
            autoFocus
            value={newName}
            maxLength={GSC_TRACKER_GROUP_NAME_MAX}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Group name"
            aria-label="New group name"
          />
        ) : null}
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
            pending={add.isPending}
            disabled={target === "new" && !newName.trim()}
            onClick={() => add.mutate()}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
