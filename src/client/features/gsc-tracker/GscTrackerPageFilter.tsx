import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import {
  activeFilterCount,
  EMPTY_PAGE_FILTER,
  URL_FILTER_MODES,
  type PageFilterValue,
} from "@/client/features/gsc-tracker/gscTrackerGroupsView";
import type { GscTrackerUrlFilterMode } from "@/shared/gsc-tracker";

const label =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Narrows the page list by URL (text, a regular expression, or a pasted list
 * of URLs) and by the queries a page earns, applied together.
 */
export function PageFilterPanel({
  value,
  onApply,
}: {
  value: PageFilterValue;
  onApply: (filter: PageFilterValue) => void;
}) {
  const [draft, setDraft] = useState<PageFilterValue>(value);
  const dirty =
    Number(draft.url.trim() !== value.url || draft.urlMode !== value.urlMode) +
    Number(draft.queries.trim() !== value.queries);
  const active = activeFilterCount(value);
  const apply = (next: PageFilterValue) => {
    const cleaned = {
      urlMode: next.urlMode,
      url: next.url.trim(),
      queries: next.queries.trim(),
    };
    setDraft(cleaned);
    onApply(cleaned);
  };
  return (
    <form
      className="space-y-3 border-b border-border bg-muted/20 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply(draft);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Refine table results</p>
          {active > 0 ? <Badge size="sm">{active} active</Badge> : null}
          {dirty > 0 ? (
            <Badge variant="warning" size="sm">
              {dirty} unapplied
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={active === 0 && dirty === 0}
          onClick={() => apply(EMPTY_PAGE_FILTER)}
        >
          <RotateCcw data-icon="inline-start" />
          Clear all
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <span className={label}>Page URL</span>
          <Select
            items={URL_FILTER_MODES}
            value={draft.urlMode}
            onValueChange={(mode: GscTrackerUrlFilterMode | null) =>
              setDraft((current) => ({
                ...current,
                urlMode: mode ?? "contains",
              }))
            }
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-52"
              aria-label="URL match"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {URL_FILTER_MODES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {draft.urlMode === "list" ? (
            <Textarea
              aria-label="URLs"
              rows={4}
              value={draft.url}
              onChange={(event) =>
                setDraft((current) => ({ ...current, url: event.target.value }))
              }
              placeholder={"One URL per line\nhttps://example.com/page/"}
            />
          ) : (
            <Input
              className="h-7"
              aria-label="Page URL filter"
              value={draft.url}
              maxLength={4096}
              onChange={(event) =>
                setDraft((current) => ({ ...current, url: event.target.value }))
              }
              placeholder={
                draft.urlMode === "regex" ? "/blog/\\d{4}/" : "URL or subfolder"
              }
            />
          )}
        </div>
        <div className="space-y-1.5">
          <span className={label}>Earns a query containing</span>
          <Textarea
            aria-label="Query phrases"
            rows={draft.urlMode === "list" ? 6 : 3}
            value={draft.queries}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                queries: event.target.value,
              }))
            }
            placeholder={"One phrase per line\nrunning shoes"}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        All filters must match. Contains ignores case. A regex is tested on the
        full URL, ignoring case. A list matches URLs regardless of scheme,
        “www.” or a trailing slash. Phrases match any query a page earned in the
        period.
      </p>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={dirty === 0}
          onClick={() => setDraft(value)}
        >
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={dirty === 0}>
          Apply filters
          {dirty > 0 ? (
            <Badge variant="secondary" size="sm" className="ml-1">
              {dirty}
            </Badge>
          ) : null}
        </Button>
      </div>
    </form>
  );
}
