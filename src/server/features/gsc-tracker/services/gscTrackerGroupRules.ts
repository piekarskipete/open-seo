import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import {
  GscTrackerGroupRepository,
  type GscTrackerUrlGroup,
} from "../repositories/GscTrackerGroupRepository";
import { collectSitemapUrls } from "@/server/lib/audit/discovery";
import { AppError, describeError } from "@/server/lib/errors";
import { comparableUrl } from "@/shared/gsc-tracker";

// How a page group keeps its URLs: directory and regex groups take every
// page Search Console reports that matches, sitemap groups every URL their
// sitemap lists (fetched again daily). New pages are picked up as they come.

const SITEMAP_REFRESH_MS = 24 * 60 * 60 * 1000;
// URLs one sitemap group keeps, and pages one refresh looks at.
const SITEMAP_MAX_URLS = 50_000;
const SCAN_BATCH = 2_500;
const SCAN_BATCHES_PER_REFRESH = 20;

/** The expression a regex group matches URLs with, or null when invalid. */
export function compileGroupRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Whether `value` is `prefix` itself or something under it. */
function underPrefix(value: string, prefix: string): boolean {
  const base = prefix.replace(/\/+$/, "");
  return value === base || value.startsWith(`${base}/`);
}

/** Whether a page belongs under a directory: a path ("/blog/") matches on
 *  any host, a full URL on its own host (scheme and "www." aside). */
function matchesDirectory(directory: string, url: string): boolean {
  const pattern = directory.trim();
  if (!pattern) return false;
  if (pattern.startsWith("/"))
    return underPrefix(pathnameOf(url).toLowerCase(), pattern.toLowerCase());
  return underPrefix(comparableUrl(url), comparableUrl(pattern));
}

/** Whether a rule (directory or regex) picks a page. */
function matchesRule(
  group: Pick<GscTrackerUrlGroup, "kind" | "pattern">,
  url: string,
  regex = group.kind === "regex" && group.pattern
    ? compileGroupRegex(group.pattern)
    : null,
): boolean {
  if (!group.pattern) return false;
  if (group.kind === "directory") return matchesDirectory(group.pattern, url);
  if (group.kind === "regex") return regex?.test(url) ?? false;
  return false;
}

/** The domain a Search Console property covers, without "www.". */
function propertyDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:"))
    return siteUrl.slice("sc-domain:".length).toLowerCase();
  try {
    return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Whether a URL is on the property's domain or one of its subdomains. */
function isOnProperty(siteUrl: string, url: string): boolean {
  const domain = propertyDomain(siteUrl);
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

/** Every page URL the site has, by its comparable form. */
async function sitePagesByKey(siteId: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  let after = 0;
  for (;;) {
    const batch = await GscTrackerGroupRepository.pagesAfter(
      siteId,
      after,
      SCAN_BATCH * 4,
    );
    for (const page of batch) pages.set(comparableUrl(page.url), page.url);
    if (batch.length < SCAN_BATCH * 4) break;
    after = batch[batch.length - 1].id;
  }
  return pages;
}

// A sitemap read for the page list's filter is kept this long, so changing
// the period or another filter doesn't fetch it again.
const SITEMAP_CACHE_MS = 10 * 60 * 1000;
const sitemapCache = new Map<string, { at: number; urls: string[] }>();

/** Checks a sitemap address: a full http(s) URL on the property's domain. */
export function requireSitemapUrl(site: GscTrackerSite, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Enter the sitemap's full URL.");
  }
  if (!/^https?:$/.test(url.protocol) || !isOnProperty(site.siteUrl, value))
    throw new AppError(
      "VALIDATION_ERROR",
      "The sitemap must be on this site's domain.",
    );
  return url.toString();
}

/**
 * The page URLs a sitemap lists (indexes followed), each in the spelling
 * Search Console reports for the same page where it knows one. `fresh`
 * skips the short-lived cache.
 */
export async function readSitemapUrls(
  site: GscTrackerSite,
  sitemapUrl: string,
  fresh = false,
): Promise<string[]> {
  const address = requireSitemapUrl(site, sitemapUrl);
  const key = `${site.id} ${address}`;
  const cached = sitemapCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < SITEMAP_CACHE_MS)
    return cached.urls;
  const listed = await collectSitemapUrls({
    sources: [address],
    origin: new URL(address).origin,
    maxUrls: SITEMAP_MAX_URLS,
  });
  if (listed.size === 0)
    throw new AppError(
      "VALIDATION_ERROR",
      "The sitemap couldn't be read or lists no URLs.",
    );
  const known = await sitePagesByKey(site.id);
  const urls = [
    ...new Set([...listed].map((url) => known.get(comparableUrl(url)) ?? url)),
  ];
  sitemapCache.set(key, { at: Date.now(), urls });
  return urls;
}

/** Reads the group's sitemap and adds the URLs it doesn't hold yet. */
async function refreshSitemap(site: GscTrackerSite, group: GscTrackerUrlGroup) {
  if (!group.pattern) return;
  const urls = await readSitemapUrls(site, group.pattern, true);
  await GscTrackerGroupRepository.addMembers(group.id, urls, "rule");
}

/**
 * Looks at the site's pages seen since the group's last refresh: a rule
 * group adds the ones it matches, and a sitemap or hand-picked group takes
 * Search Console's spelling of a URL it holds in another form (a missing
 * trailing slash, say), so its numbers line up.
 */
async function scanNewPages(site: GscTrackerSite, group: GscTrackerUrlGroup) {
  const regex =
    group.kind === "regex" && group.pattern
      ? compileGroupRegex(group.pattern)
      : null;
  let aliases: Map<string, string> | null = null;
  let watermark = group.scannedPageId;
  for (let pass = 0; pass < SCAN_BATCHES_PER_REFRESH; pass++) {
    const pages = await GscTrackerGroupRepository.pagesAfter(
      site.id,
      watermark,
      SCAN_BATCH,
    );
    if (pages.length === 0) break;
    if (group.kind === "directory" || group.kind === "regex") {
      const matched = pages
        .filter((page) => matchesRule(group, page.url, regex))
        .map((page) => page.url);
      await GscTrackerGroupRepository.addMembers(group.id, matched, "rule");
    } else {
      aliases ??= new Map(
        (await GscTrackerGroupRepository.listMembers(group.id)).map(
          (member) => [comparableUrl(member.url), member.url],
        ),
      );
      for (const page of pages) {
        const held = aliases.get(comparableUrl(page.url));
        if (held === undefined || held === page.url) continue;
        await GscTrackerGroupRepository.renameMember(group.id, held, page.url);
        aliases.set(comparableUrl(page.url), page.url);
      }
    }
    watermark = pages[pages.length - 1].id;
    if (pages.length < SCAN_BATCH) break;
  }
  return watermark;
}

/** Brings one group up to date. `force` reads a sitemap even when it was
 *  read within the day. */
export async function refreshGroup(
  site: GscTrackerSite,
  group: GscTrackerUrlGroup,
  now = new Date(),
  force = false,
): Promise<void> {
  try {
    const sitemapDue =
      group.kind === "sitemap" &&
      (force ||
        !group.lastRefreshedAt ||
        now.getTime() - new Date(group.lastRefreshedAt).getTime() >
          SITEMAP_REFRESH_MS);
    if (sitemapDue) await refreshSitemap(site, group);
    const scannedPageId = await scanNewPages(site, group);
    await GscTrackerGroupRepository.update(group.id, {
      scannedPageId,
      ...(group.kind !== "sitemap" || sitemapDue
        ? { lastRefreshedAt: now.toISOString(), lastError: null }
        : {}),
    });
  } catch (error) {
    await GscTrackerGroupRepository.update(group.id, {
      lastError:
        error instanceof AppError
          ? error.message
          : "The group couldn't be refreshed. The next sync tries again.",
      // A failed sitemap waits a day like a read one, not every tick.
      ...(group.kind === "sitemap"
        ? { lastRefreshedAt: now.toISOString() }
        : {}),
    });
    console.error("[gsc-tracker] group refresh failed", {
      groupId: group.id,
      error: describeError(error),
    });
  }
}

/** Cron step: every group of the site. */
export async function refreshSiteGroups(
  site: GscTrackerSite,
  now = new Date(),
) {
  for (const group of await GscTrackerGroupRepository.list(site.id))
    await refreshGroup(site, group, now);
}
