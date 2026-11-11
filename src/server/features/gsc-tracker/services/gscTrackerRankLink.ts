import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  rankCheckRuns,
  rankSnapshots,
  rankTrackingConfigs,
  rankTrackingKeywords,
} from "@/db/schema";
import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { propertyDomain } from "./gscTrackerGroupRules";
import { AppError } from "@/server/lib/errors";
import { normalizeQuery } from "@/shared/gsc-tracker";

// Followed phrases next to the project's Rank Tracking (a SERP check per
// device): a site links one tracked domain, and each phrase reads that
// domain's position for the same keyword, day by day.

type RankDevice = "desktop" | "mobile";

/** Each followed phrase's keyword in the linked domain, by phrase id. */
type PhraseRanks = Record<
  string,
  {
    trackingKeywordId: string | null;
    days: Record<string, { position: number | null; url: string | null }>;
  }
>;

/** The project's Rank Tracking domains a site can link. */
async function listConfigs(projectId: string) {
  const configs = await db
    .select({
      id: rankTrackingConfigs.id,
      domain: rankTrackingConfigs.domain,
      locationName: rankTrackingConfigs.locationName,
      locationCode: rankTrackingConfigs.locationCode,
      languageCode: rankTrackingConfigs.languageCode,
      devices: rankTrackingConfigs.devices,
    })
    .from(rankTrackingConfigs)
    .where(
      and(
        eq(rankTrackingConfigs.projectId, projectId),
        eq(rankTrackingConfigs.isActive, true),
      ),
    )
    .orderBy(rankTrackingConfigs.domain);
  return configs;
}

type Config = Awaited<ReturnType<typeof listConfigs>>[number];

/** The device a link reads: the chosen one when the domain checks it,
 *  otherwise the one it checks. */
function deviceFor(config: Config, chosen: string | null): RankDevice {
  if (config.devices === "desktop") return "desktop";
  if (config.devices === "mobile") return "mobile";
  return chosen === "desktop" ? "desktop" : "mobile";
}

/** Links a site to one of its project's Rank Tracking domains, or unlinks
 *  it with null. */
async function saveLink(
  site: GscTrackerSite,
  link: { configId: string | null; device?: RankDevice },
) {
  if (link.configId) {
    const configs = await listConfigs(site.projectId);
    if (!configs.some((config) => config.id === link.configId))
      throw new AppError(
        "NOT_FOUND",
        "That Rank Tracking domain isn't in this project.",
      );
  }
  await GscTrackerRepository.update(site.id, {
    rankConfigId: link.configId,
    ...(link.device ? { rankDevice: link.device } : {}),
  });
}

/**
 * The site's link and, for each followed phrase, the linked domain's keyword
 * (null when it isn't tracked there) with its position and ranking URL per
 * day from `from` to `to`. The latest check of a day counts.
 */
async function getRankComparison(input: {
  site: GscTrackerSite;
  from: string;
  to: string;
}) {
  const { site } = input;
  const configs = await listConfigs(site.projectId);
  const domain = propertyDomain(site.siteUrl);
  // A domain matching the property, offered when nothing is linked yet.
  const suggested =
    configs.find(
      (config) => config.domain.toLowerCase().replace(/^www\./, "") === domain,
    )?.id ?? null;
  const config = configs.find((item) => item.id === site.rankConfigId);
  if (!config)
    return { configs, suggested, link: null, keywords: {} as PhraseRanks };
  const device = deviceFor(config, site.rankDevice);

  const [phrases, tracked] = await Promise.all([
    GscTrackerKeywordRepository.list(site.id),
    db
      .select({
        id: rankTrackingKeywords.id,
        keyword: rankTrackingKeywords.keyword,
      })
      .from(rankTrackingKeywords)
      .where(eq(rankTrackingKeywords.configId, config.id)),
  ]);
  const byKeyword = new Map(
    tracked.map((item) => [normalizeQuery(item.keyword), item.id]),
  );
  const snapshots = await db
    .select({
      trackingKeywordId: rankSnapshots.trackingKeywordId,
      date: sql<string>`substr(${rankSnapshots.checkedAt}, 1, 10)`,
      position: rankSnapshots.position,
      url: rankSnapshots.url,
    })
    .from(rankSnapshots)
    .innerJoin(rankCheckRuns, eq(rankCheckRuns.id, rankSnapshots.runId))
    .where(
      and(
        eq(rankCheckRuns.configId, config.id),
        eq(rankSnapshots.device, device),
        gte(rankSnapshots.checkedAt, input.from),
        lte(rankSnapshots.checkedAt, `${input.to}T23:59:59`),
        inArray(
          rankSnapshots.trackingKeywordId,
          db
            .select({ id: rankTrackingKeywords.id })
            .from(rankTrackingKeywords)
            .where(eq(rankTrackingKeywords.configId, config.id)),
        ),
      ),
    )
    // Oldest first, so a later check of the same day wins.
    .orderBy(rankSnapshots.checkedAt, desc(rankSnapshots.id));
  const days = new Map<
    string,
    Record<string, { position: number | null; url: string | null }>
  >();
  for (const row of snapshots) {
    const keywordDays = days.get(row.trackingKeywordId) ?? {};
    keywordDays[row.date] = { position: row.position, url: row.url };
    days.set(row.trackingKeywordId, keywordDays);
  }

  return {
    configs,
    suggested,
    link: {
      configId: config.id,
      domain: config.domain,
      device,
      devices: config.devices,
    },
    keywords: Object.fromEntries<PhraseRanks[string]>(
      phrases.map((phrase) => {
        const trackingId = byKeyword.get(normalizeQuery(phrase.query)) ?? null;
        return [
          phrase.id,
          {
            trackingKeywordId: trackingId,
            days: trackingId ? (days.get(trackingId) ?? {}) : {},
          },
        ];
      }),
    ),
  };
}

export const GscTrackerRankLink = { listConfigs, saveLink, getRankComparison };
