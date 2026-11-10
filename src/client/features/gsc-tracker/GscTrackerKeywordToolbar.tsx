import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { TagChip } from "@/client/features/gsc-tracker/GscTrackerTagChip";
import {
  refreshTags,
  TAG_COLORS,
  tagColor,
  UNTAGGED,
  type Tag,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import { tagGscTrackerKeywords } from "@/serverFunctions/gscTrackerTags";

/** Tag buttons that narrow the phrase list; several chosen show any of them. */
export function TagFilter({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const options = [
    ...tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    { id: UNTAGGED, name: "Untagged", color: "gray" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Tags:</span>
      {options.map((option) => {
        const active = value.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option.id)}
            className={cn(
              "rounded-full transition-opacity",
              active
                ? "ring-2 ring-ring ring-offset-1 ring-offset-background"
                : "opacity-60 hover:opacity-100",
            )}
          >
            <TagChip
              name={option.name}
              color={option.color}
              className={
                option.id === UNTAGGED ? "border border-dashed" : undefined
              }
            />
          </button>
        );
      })}
      {value.size > 0 ? (
        <Button variant="ghost" size="xs" onClick={() => onChange(new Set())}>
          <X className="size-3" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

/** Adds a tag to, or takes it off, every selected phrase. */
export function SelectionBar({
  projectId,
  selected,
  tags,
  tagsOnSelection,
  onClear,
  onManageTags,
}: {
  projectId: string;
  selected: string[];
  tags: Tag[];
  /** Tag ids at least one selected phrase carries. */
  tagsOnSelection: ReadonlySet<string>;
  onClear: () => void;
  onManageTags: () => void;
}) {
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: (input: { tag: Tag; action: "add" | "remove" }) =>
      tagGscTrackerKeywords({
        data: {
          projectId,
          tagId: input.tag.id,
          keywordIds: selected,
          action: input.action,
        },
      }),
    onSuccess: (result, input) => {
      const phrases = `${result.changed} phrase${result.changed === 1 ? "" : "s"}`;
      toast.success(
        input.action === "add"
          ? `“${input.tag.name}” added to ${phrases}`
          : `“${input.tag.name}” removed from ${phrases}`,
      );
      refreshTags(queryClient, projectId);
    },
  });
  const removable = tags.filter((tag) => tagsOnSelection.has(tag.id));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
      <span className="font-medium tabular-nums">
        {selected.length} selected
      </span>
      <TagMenu
        label="Add tag"
        tags={tags}
        disabled={apply.isPending}
        onPick={(tag) => apply.mutate({ tag, action: "add" })}
        onManageTags={onManageTags}
        empty="No tags yet"
      />
      <TagMenu
        label="Remove tag"
        tags={removable}
        disabled={apply.isPending || removable.length === 0}
        onPick={(tag) => apply.mutate({ tag, action: "remove" })}
      />
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

function TagMenu({
  label,
  tags,
  disabled,
  onPick,
  onManageTags,
  empty,
}: {
  label: string;
  tags: Tag[];
  disabled?: boolean;
  onPick: (tag: Tag) => void;
  onManageTags?: () => void;
  empty?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" disabled={disabled} />}
      >
        <Tags className="size-3.5" />
        {label}
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44">
        {tags.length === 0 && empty ? (
          <DropdownMenuItem disabled>{empty}</DropdownMenuItem>
        ) : null}
        {tags.map((tag) => (
          <DropdownMenuItem key={tag.id} onClick={() => onPick(tag)}>
            <span
              className={cn(
                "size-2.5 rounded-full",
                TAG_COLORS[tagColor(tag.color)].swatch,
              )}
            />
            {tag.name}
          </DropdownMenuItem>
        ))}
        {onManageTags ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageTags}>
              Manage tags…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
