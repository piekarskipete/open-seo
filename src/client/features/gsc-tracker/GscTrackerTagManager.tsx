import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/client/components/ConfirmDialog";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { TagColorPicker } from "@/client/features/gsc-tracker/GscTrackerTagChip";
import {
  refreshTags,
  useTags,
  type Tag,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import {
  createGscTrackerTag,
  deleteGscTrackerTag,
  updateGscTrackerTag,
} from "@/serverFunctions/gscTrackerTags";
import {
  GSC_TRACKER_TAG_NAME_MAX,
  type GscTrackerTagColor,
} from "@/shared/gsc-tracker";

/** Creates, renames, recolors and deletes the project's tags. */
export function TagManagerDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const tags = useTags(projectId);
  const [removing, setRemoving] = useState<Tag | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
          <DialogDescription>
            Group followed phrases with colored tags. In the Keywords tab,
            select phrases to add or remove a tag, and filter the list by tag.
          </DialogDescription>
        </DialogHeader>
        {tags.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : tags.data && tags.data.length > 0 ? (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {tags.data.map((tag) => (
              <TagRow
                key={tag.id}
                projectId={projectId}
                tag={tag}
                onRemove={() => setRemoving(tag)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        )}
        <NewTagForm projectId={projectId} />
      </DialogContent>
      {removing ? (
        <RemoveTagDialog
          projectId={projectId}
          tag={removing}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Dialog>
  );
}

function TagRow({
  projectId,
  tag,
  onRemove,
}: {
  projectId: string;
  tag: Tag;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (values: { name?: string; color?: GscTrackerTagColor }) =>
      updateGscTrackerTag({ data: { projectId, id: tag.id, ...values } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      refreshTags(queryClient, projectId);
    },
  });
  const rename = () => {
    if (name.trim() && name.trim() !== tag.name) save.mutate({ name });
    else setName(tag.name);
  };
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <TagColorPicker
          value={tag.color}
          onChange={(color) => save.mutate({ color })}
        />
        <Input
          value={name}
          maxLength={GSC_TRACKER_TAG_NAME_MAX}
          aria-label={`Name of tag ${tag.name}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-8"
        />
        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {tag.phrases} phrase{tag.phrases === 1 ? "" : "s"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete tag ${tag.name}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="pl-10 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function NewTagForm({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<GscTrackerTagColor>("blue");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createGscTrackerTag({ data: { projectId, name, color } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setError(null);
      refreshTags(queryClient, projectId);
    },
  });
  return (
    <form
      className="space-y-1 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <TagColorPicker value={color} onChange={setColor} />
        <Input
          value={name}
          maxLength={GSC_TRACKER_TAG_NAME_MAX}
          placeholder="New tag, e.g. Blog or Priority"
          aria-label="New tag name"
          onChange={(event) => setName(event.target.value)}
          className="h-8"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!name.trim()}
          pending={create.isPending}
        >
          Add tag
        </Button>
      </div>
      {error ? (
        <p role="alert" className="pl-10 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RemoveTagDialog({
  projectId,
  tag,
  onClose,
}: {
  projectId: string;
  tag: Tag;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteGscTrackerTag({ data: { projectId, id: tag.id } }),
    onSuccess: () => {
      refreshTags(queryClient, projectId);
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Delete “${tag.name}”?`}
      confirmLabel="Delete tag"
      destructive
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {tag.phrases > 0
        ? `It comes off ${tag.phrases} phrase${tag.phrases === 1 ? "" : "s"}. The phrases themselves stay followed.`
        : "No phrase carries it yet."}
    </ConfirmDialog>
  );
}
