import { useState } from "react";
import { RankBulkButton } from "@/client/features/gsc-tracker/GscTrackerRankCompare";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import {
  TableBulkActionBar,
  TableBulkActionButton,
} from "@/client/components/table/TableBulkActionBar";
import { SavedKeywordsBulkTagsModal } from "@/client/features/saved-keywords/SavedKeywordsBulkTagsModal";
import { SavedKeywordsTagFilter } from "@/client/features/saved-keywords/SavedKeywordsTagFilter";
import {
  CheckpointsButton,
  StartDateButton,
} from "@/client/features/gsc-tracker/GscTrackerKeywordStats";
import {
  refreshTags,
  type Tag,
} from "@/client/features/gsc-tracker/gscTrackerTags";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  applyGscTrackerKeywordTags,
  deleteGscTrackerTag,
  updateGscTrackerTag,
} from "@/serverFunctions/gscTrackerTags";
import type { TagColorKey } from "@/shared/tag-colors";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";

/** The tag filter, with renaming, recoloring and deleting tags, as on
 *  Saved Keywords; these tags are the tracker's own. */
export function KeywordTagFilter({
  projectId,
  tags,
  value,
  onChange,
}: {
  projectId: string;
  tags: Tag[];
  value: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const run = async (tagId: string, action: () => Promise<unknown>) => {
    setBusy((current) => new Set(current).add(tagId));
    try {
      await action();
      refreshTags(queryClient, siteId);
    } catch (error) {
      toast.error(getStandardErrorMessage(error, "Could not change the tag"));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(tagId);
        return next;
      });
    }
  };
  return (
    <SavedKeywordsTagFilter
      availableTags={tags}
      selectedTagIds={value}
      busyTagIds={busy}
      onSelectedTagIdsChange={onChange}
      onUpdateTag={(input: {
        tagId: string;
        name?: string;
        color?: TagColorKey | null;
      }) =>
        void run(input.tagId, () =>
          updateGscTrackerTag({
            data: {
              projectId,
              siteId,
              tagId: input.tagId,
              name: input.name,
              color: input.color ?? undefined,
            },
          }),
        )
      }
      onDeleteTag={(tagId) => {
        onChange(value.filter((id) => id !== tagId));
        void run(tagId, () =>
          deleteGscTrackerTag({ data: { projectId, siteId, tagId } }),
        );
      }}
    />
  );
}

/** The bar at the bottom while phrases are selected: tags, start date and
 *  checkpoints for all of them at once. */
export function KeywordBulkBar({
  projectId,
  selected,
  tags,
  selectedTags,
  rankKeywords,
  startDate,
  anyCustomStart,
  checkpoints,
  onClear,
}: {
  projectId: string;
  selected: string[];
  tags: Tag[];
  /** The selected phrases, for adding them to Rank Tracking. */
  rankKeywords?: Parameters<typeof RankBulkButton>[0]["keywords"];
  /** Tags at least one selected phrase carries. */
  selectedTags: Tag[];
  /** The date the start-date picker opens on. */
  startDate: string;
  /** Whether a selected phrase has a start date set by hand. */
  anyCustomStart: boolean;
  /** The checkpoints the picker opens on. */
  checkpoints: string[];
  onClear: () => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [tagging, setTagging] = useState(false);
  const apply = useMutation({
    mutationFn: (input: { addTags?: string[]; removeTagIds?: string[] }) =>
      applyGscTrackerKeywordTags({
        data: { projectId, siteId, keywordIds: selected, ...input },
      }),
    onSuccess: (result) => {
      toast.success(
        `Tags updated on ${result.changed} phrase${result.changed === 1 ? "" : "s"}`,
      );
      refreshTags(queryClient, siteId);
      setTagging(false);
    },
  });
  return (
    <>
      <TableBulkActionBar
        selectedCount={selected.length}
        onClear={onClear}
        actions={
          <div className="flex items-center gap-0.5 px-1.5">
            <TableBulkActionButton
              icon={<Tags className="size-3.5" />}
              onClick={() => setTagging(true)}
            >
              Tag
            </TableBulkActionButton>
            <StartDateButton
              projectId={projectId}
              ids={selected}
              initialDate={startDate}
              canReset={anyCustomStart}
              inBar
            />
            <CheckpointsButton
              projectId={projectId}
              ids={selected}
              initial={checkpoints}
              inBar
            />
            {rankKeywords ? <RankBulkButton keywords={rankKeywords} /> : null}
          </div>
        }
      />
      {tagging ? (
        <SavedKeywordsBulkTagsModal
          availableTags={tags}
          selectedCount={selected.length}
          selectedRowTags={selectedTags}
          isPending={apply.isPending}
          onClose={() => setTagging(false)}
          onApply={(input) => apply.mutate(input)}
        />
      ) : null}
    </>
  );
}
