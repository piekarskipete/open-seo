import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/client/components/ui/textarea";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { addGscTrackerKeywords } from "@/serverFunctions/gscTracker";
import { useSiteId } from "@/client/features/gsc-tracker/gscTrackerView";

/** One line per phrase: "phrase | https://target-url" (a tab or ";" works too). */
function parseEntries(text: string) {
  const entries: { query: string; targetUrl: string }[] = [];
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [query, targetUrl] = line.split(/\s*[|\t;]\s*/);
    if (query?.trim() && targetUrl && /^https?:\/\/\S+$/.test(targetUrl.trim()))
      entries.push({ query: query.trim(), targetUrl: targetUrl.trim() });
    else invalid.push(line.trim());
  }
  return { entries, invalid };
}

export function AddPhrasesDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const siteId = useSiteId();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const { entries, invalid } = parseEntries(text);
  const add = useMutation({
    meta: { errorToast: false },
    mutationFn: () =>
      addGscTrackerKeywords({ data: { projectId, siteId, entries } }),
    onSuccess: (saved) => {
      toast.success(
        `${saved.added} phrase${saved.added === 1 ? "" : "s"} added${
          saved.skipped > 0 ? `, ${saved.skipped} already followed` : ""
        }`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["gscTrackerKeywords", siteId],
      });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Follow phrases</DialogTitle>
          <DialogDescription>
            One per line: the phrase, then the URL that should rank for it.
            Recent days load right away, older ones over the next hours.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Phrases and target URLs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            "running shoes | https://example.com/running-shoes/\ntrail shoes | https://example.com/trail/"
          }
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {entries.length} ready
          {invalid.length > 0
            ? ` · ${invalid.length} line${invalid.length === 1 ? "" : "s"} skipped (needs “phrase | https://…”)`
            : ""}
        </p>
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
            onClick={() => add.mutate()}
            disabled={entries.length === 0}
            pending={add.isPending}
          >
            Follow {entries.length || ""} phrase
            {entries.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
