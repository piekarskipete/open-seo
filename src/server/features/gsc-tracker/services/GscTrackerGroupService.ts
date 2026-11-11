import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import {
  GscTrackerGroupRepository,
  type GscTrackerUrlGroup,
} from "../repositories/GscTrackerGroupRepository";
import {
  compileGroupRegex,
  refreshGroup,
  requireSitemapUrl,
} from "./gscTrackerGroupRules";
import {
  dailySeries,
  groupTotals,
  listPages,
  pageDetail,
  pagePeriods,
  type PageFilter,
} from "./gscTrackerPageStats";
import { pageHistoryProgress } from "./gscTrackerPageSync";
import { AppError } from "@/server/lib/errors";
import {
  GSC_TRACKER_GROUP_NAME_MAX,
  type GscTrackerGroupKind,
} from "@/shared/gsc-tracker";

// Page groups: sets of URLs a site follows together, by hand or by a rule
// (a sitemap, a directory, a regular expression), with their totals.

const MAX_PATTERN_LENGTH = 2_048;

function groupKind(kind: string): GscTrackerGroupKind {
  return kind === "sitemap" || kind === "directory" || kind === "regex"
    ? kind
    : "manual";
}

function cleanName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new AppError("VALIDATION_ERROR", "Name the group.");
  if (cleaned.length > GSC_TRACKER_GROUP_NAME_MAX)
    throw new AppError(
      "VALIDATION_ERROR",
      `Keep the name under ${GSC_TRACKER_GROUP_NAME_MAX} characters.`,
    );
  return cleaned;
}

/** A rule's pattern, checked for its kind; null for a manual group. */
function cleanPattern(
  site: GscTrackerSite,
  kind: GscTrackerGroupKind,
  pattern: string | undefined,
): string | null {
  if (kind === "manual") return null;
  const value = pattern?.trim() ?? "";
  if (!value)
    throw new AppError(
      "VALIDATION_ERROR",
      kind === "sitemap"
        ? "Enter the sitemap's URL."
        : kind === "directory"
          ? "Enter a directory, such as /blog/."
          : "Enter a regular expression.",
    );
  if (value.length > MAX_PATTERN_LENGTH)
    throw new AppError("VALIDATION_ERROR", "That pattern is too long.");
  if (kind === "directory" && /\.xml(\.gz)?([?#].*)?$/i.test(value))
    throw new AppError(
      "VALIDATION_ERROR",
      "That's a sitemap's address: pick Sitemap to follow the URLs it lists.",
    );
  if (kind === "regex" && !compileGroupRegex(value))
    throw new AppError(
      "VALIDATION_ERROR",
      "That regular expression isn't valid.",
    );
  if (kind === "sitemap") return requireSitemapUrl(site, value);
  return value;
}

async function requireGroup(site: GscTrackerSite, groupId: string) {
  const group = await GscTrackerGroupRepository.getForSite(site.id, groupId);
  if (!group) throw new AppError("NOT_FOUND", "That group no longer exists.");
  return group;
}

async function requireUniqueName(
  site: GscTrackerSite,
  name: string,
  exceptId?: string,
) {
  const existing = await GscTrackerGroupRepository.findByName(site.id, name);
  if (existing && existing.id !== exceptId)
    throw new AppError("CONFLICT", `A group named “${name}” already exists.`);
}

function describe(group: GscTrackerUrlGroup) {
  return {
    id: group.id,
    name: group.name,
    kind: groupKind(group.kind),
    pattern: group.pattern,
    lastRefreshedAt: group.lastRefreshedAt,
    lastError: group.lastError,
  };
}

/** The site's groups with their URL counts and totals for the window, and
 *  how far the per-page history reaches. */
async function listGroups(site: GscTrackerSite, days: number) {
  const range = pagePeriods(site, days);
  const [groups, counts, totals] = await Promise.all([
    GscTrackerGroupRepository.list(site.id),
    GscTrackerGroupRepository.memberCounts(site.id),
    range ? groupTotals(site, range) : Promise.resolve(new Map()),
  ]);
  const empty = {
    current: { clicks: 0, impressions: 0, ctr: null, position: null },
    previous: { clicks: 0, impressions: 0, ctr: null, position: null },
  };
  return {
    range,
    pagesOldestDate: site.pagesOldestDate,
    pagesNewestDate: site.pagesNewestDate,
    progress: pageHistoryProgress(site),
    groups: groups.map((group) => ({
      ...describe(group),
      urls: counts.get(group.id) ?? 0,
      ...(totals.get(group.id) ?? empty),
    })),
  };
}

/** One group's window totals and daily series, for its header. */
async function getGroup(site: GscTrackerSite, groupId: string, days: number) {
  const group = await requireGroup(site, groupId);
  const range = pagePeriods(site, days);
  const [counts, totals, series] = await Promise.all([
    GscTrackerGroupRepository.memberCounts(site.id),
    range ? groupTotals(site, range) : Promise.resolve(new Map()),
    range ? dailySeries(site, range, { groupId }) : Promise.resolve([]),
  ]);
  return {
    ...describe(group),
    urls: counts.get(group.id) ?? 0,
    range,
    totals: totals.get(group.id) ?? null,
    series,
  };
}

async function createGroup(input: {
  site: GscTrackerSite;
  name: string;
  kind: GscTrackerGroupKind;
  pattern?: string;
  urls?: string[];
}) {
  const name = cleanName(input.name);
  const pattern = cleanPattern(input.site, input.kind, input.pattern);
  await requireUniqueName(input.site, name);
  const id = crypto.randomUUID();
  await GscTrackerGroupRepository.create({
    id,
    projectId: input.site.projectId,
    siteId: input.site.id,
    name,
    kind: input.kind,
    pattern,
  });
  if (input.urls?.length)
    await GscTrackerGroupRepository.addMembers(id, input.urls, "manual");
  // A rule group fills in right away; the cron keeps it current.
  const group = await requireGroup(input.site, id);
  if (input.kind !== "manual")
    await refreshGroup(input.site, group, new Date(), true);
  return { id };
}

/** Renames a group or changes its rule; a changed rule looks at every page
 *  again and keeps the URLs it already holds. */
async function updateGroup(input: {
  site: GscTrackerSite;
  groupId: string;
  name?: string;
  pattern?: string;
}) {
  const group = await requireGroup(input.site, input.groupId);
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name) await requireUniqueName(input.site, name, group.id);
  const kind = groupKind(group.kind);
  const pattern =
    input.pattern === undefined || kind === "manual"
      ? undefined
      : cleanPattern(input.site, kind, input.pattern);
  const ruleChanged = pattern !== undefined && pattern !== group.pattern;
  await GscTrackerGroupRepository.update(group.id, {
    ...(name ? { name } : {}),
    ...(ruleChanged
      ? { pattern, scannedPageId: 0, lastRefreshedAt: null }
      : {}),
  });
  if (ruleChanged) {
    const fresh = await requireGroup(input.site, group.id);
    await refreshGroup(input.site, fresh, new Date(), true);
  }
}

async function deleteGroup(site: GscTrackerSite, groupId: string) {
  const group = await requireGroup(site, groupId);
  await GscTrackerGroupRepository.remove(group.id);
}

/** Puts URLs into a group, bringing back ones taken out earlier. */
async function addUrls(site: GscTrackerSite, groupId: string, urls: string[]) {
  const group = await requireGroup(site, groupId);
  await GscTrackerGroupRepository.addMembers(group.id, urls, "manual");
  await GscTrackerGroupRepository.includeMembers(group.id, urls);
  return { added: urls.length };
}

async function removeUrls(
  site: GscTrackerSite,
  groupId: string,
  urls: string[],
) {
  const group = await requireGroup(site, groupId);
  await GscTrackerGroupRepository.removeMembers(group.id, urls);
  return { removed: urls.length };
}

/** Reads a sitemap group's sitemap again now. */
async function refreshNow(site: GscTrackerSite, groupId: string) {
  const group = await requireGroup(site, groupId);
  await refreshGroup(site, group, new Date(), true);
}

async function getPages(input: {
  site: GscTrackerSite;
  days: number;
  groupId?: string;
  filter?: PageFilter;
}) {
  if (input.groupId) await requireGroup(input.site, input.groupId);
  return listPages(input);
}

export const GscTrackerGroupService = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  addUrls,
  removeUrls,
  refreshNow,
  getPages,
  getPageDetail: pageDetail,
};
