// Helpers for the Page Groups tab, kept apart from its components so the
// component modules only export components.

import type { QueryClient } from "@tanstack/react-query";
import {
  applyListFilter,
  type CompareRow,
  type ListFilter,
} from "@/client/features/gsc-tracker/gscTrackerView";
import type {
  GscTrackerGroupKind,
  GscTrackerUrlFilterMode,
} from "@/shared/gsc-tracker";

/** The page list's views: the query views, and pages without impressions
 *  (a sitemap's URLs Search Console doesn't show, say). */
export type PageView = ListFilter | "nodata";

export const PAGE_VIEWS: { value: PageView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "improved", label: "Improved" },
  { value: "declined", label: "Declined" },
  { value: "new", label: "New" },
  { value: "lost", label: "Lost" },
  { value: "nodata", label: "No impressions" },
];

/** Filters and orders page rows for a view. "All" keeps every row a group
 *  holds, the ones without data at the end. */
export function applyPageView(
  rows: CompareRow[],
  view: PageView,
): CompareRow[] {
  if (view === "nodata")
    return rows.filter((row) => row.current.impressions === 0);
  if (view !== "all") return applyListFilter(rows, view);
  const list = [...rows];
  list.sort(
    (a, b) =>
      b.current.clicks - a.current.clicks ||
      b.current.impressions - a.current.impressions ||
      a.key.localeCompare(b.key),
  );
  return list;
}

export const GROUP_KINDS: {
  value: GscTrackerGroupKind;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    value: "manual",
    label: "Custom list",
    hint: "Add URLs from the page list: select them and pick “Add to group”.",
    placeholder: "",
  },
  {
    value: "sitemap",
    label: "Sitemap",
    hint: "Every URL the sitemap lists, read again daily, so new URLs join on their own. Sitemap indexes are followed.",
    placeholder: "https://example.com/sitemap.xml",
  },
  {
    value: "directory",
    label: "Directory",
    hint: "Every page under the directory, including new ones as Search Console reports them.",
    placeholder: "/blog/",
  },
  {
    value: "regex",
    label: "Regex",
    hint: "Every page whose full URL matches the expression (case-insensitive), including new ones.",
    placeholder: "/product/[^/]+/$",
  },
];

export function kindLabel(kind: GscTrackerGroupKind): string {
  return GROUP_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

export const URL_FILTER_MODES: {
  value: GscTrackerUrlFilterMode;
  label: string;
}[] = [
  { value: "contains", label: "Contains" },
  { value: "regex", label: "Matches regex" },
  { value: "list", label: "Is one of (list)" },
  { value: "sitemap", label: "In sitemap" },
];

/** The page list's refine filter, as applied. */
export type PageFilterValue = {
  urlMode: GscTrackerUrlFilterMode;
  url: string;
  queries: string;
};

export const EMPTY_PAGE_FILTER: PageFilterValue = {
  urlMode: "contains",
  url: "",
  queries: "",
};

export function activeFilterCount(filter: PageFilterValue): number {
  return (
    Number(filter.url.trim() !== "") + Number(filter.queries.trim() !== "")
  );
}

/** Drops the cached group lists and page lists of a site. */
export function refreshGroups(queryClient: QueryClient, siteId: string) {
  for (const key of ["gscTrackerGroups", "gscTrackerGroup", "gscTrackerPages"])
    void queryClient.invalidateQueries({ queryKey: [key, siteId] });
}

/** What decides a group's URLs, in a line. */
export function groupRuleText(group: {
  kind: GscTrackerGroupKind;
  pattern: string | null;
}): string {
  return group.kind === "manual"
    ? "Your own list of URLs"
    : (group.pattern ?? "");
}

/** A group name from a sitemap's file name: "post-sitemap.xml" gives
 *  "post-sitemap". */
export function sitemapGroupName(sitemapUrl: string): string {
  try {
    const file = new URL(sitemapUrl).pathname.split("/").pop() ?? "";
    return file.replace(/\.xml(\.gz)?$/i, "") || "Sitemap";
  } catch {
    return "Sitemap";
  }
}

/** Whether a typed address is a sitemap's (an .xml file). */
export function looksLikeSitemap(value: string): boolean {
  return /^https?:\/\/.+\.xml(\.gz)?([?#].*)?$/i.test(value.trim());
}
