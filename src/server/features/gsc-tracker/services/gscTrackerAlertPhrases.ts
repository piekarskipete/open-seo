import type { GscTrackerSite } from "../repositories/GscTrackerRepository";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { addDays } from "./gscTrackerDates";
import { markerPoints, type TargetDay } from "./gscTrackerKeywordRanges";
import { GscTrackerRankLink } from "./gscTrackerRankLink";
import { GscTrackerTagService } from "./GscTrackerTagService";
import { comparableUrl } from "@/shared/gsc-tracker";
import type { GscTrackerAlertParams } from "@/shared/gsc-tracker-alerts";
import { summarizeRank } from "@/shared/gsc-tracker-rank";

// Alert checks on followed phrases, each on the target URL's daily numbers.

/** An alert a rule raises: about one subject (a phrase, a group…) on one
 *  day, which is what keeps it from being sent twice. */
export type AlertCandidate = {
  subject: string;
  date: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
};

// Days of phrase history a check reads: a month and a week back.
const HISTORY_DAYS = 40;
const BASELINE_DAYS = 7;

type Phrase = {
  id: string;
  query: string;
  targetUrl: string;
  startDate: string;
  checkpoints: string[];
  /** The target URL's days. */
  target: Map<string, TargetDay>;
  /** The best other page's clicks and impressions per day. */
  others: Map<string, { clicks: number; impressions: number }>;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The site's followed phrases (or one tag's) with their recent days. */
async function loadPhrases(
  site: GscTrackerSite,
  evalDate: string,
  tagId?: string,
): Promise<Phrase[]> {
  const [keywords, tags, rows] = await Promise.all([
    GscTrackerKeywordRepository.list(site.id),
    tagId ? GscTrackerTagService.tagsByKeyword(site.id) : null,
    GscTrackerKeywordRepository.listDays({
      siteId: site.id,
      from: addDays(evalDate, -HISTORY_DAYS),
      to: evalDate,
    }),
  ]);
  return keywords
    .filter((keyword) => !tags || tags.get(keyword.id)?.includes(tagId ?? ""))
    .map((keyword) => {
      const goal = comparableUrl(keyword.targetUrl);
      const target = new Map<string, TargetDay>();
      const others = new Map<string, { clicks: number; impressions: number }>();
      for (const row of rows) {
        if (row.keywordId !== keyword.id) continue;
        if (comparableUrl(row.page) === goal) {
          const day = target.get(row.date) ?? {
            clicks: 0,
            impressions: 0,
            weight: 0,
          };
          day.clicks += row.clicks;
          day.impressions += row.impressions;
          day.weight += row.position * row.impressions;
          target.set(row.date, day);
        } else {
          const best = others.get(row.date);
          if (
            !best ||
            row.clicks > best.clicks ||
            row.impressions > best.impressions
          )
            others.set(row.date, {
              clicks: Math.max(row.clicks, best?.clicks ?? 0),
              impressions: Math.max(row.impressions, best?.impressions ?? 0),
            });
        }
      }
      return {
        id: keyword.id,
        query: keyword.query,
        targetUrl: keyword.targetUrl,
        startDate: keyword.startDate ?? keyword.createdAt.slice(0, 10),
        checkpoints: [keyword.checkpoint1Date, keyword.checkpoint2Date].filter(
          (date): date is string => date !== null,
        ),
        target,
        others,
      };
    });
}

/** The latest measured day up to `evalDate` (within 3 days of it), and the
 *  average position and impressions of the 7 days before it. */
function latestAndBaseline(phrase: Phrase, evalDate: string) {
  let latest: { date: string; position: number } | null = null;
  for (let back = 0; back < 3 && !latest; back++) {
    const date = addDays(evalDate, -back);
    const day = phrase.target.get(date);
    if (day && day.impressions > 0)
      latest = { date, position: day.weight / day.impressions };
  }
  if (!latest) return null;
  let impressions = 0;
  let weight = 0;
  for (let back = 1; back <= BASELINE_DAYS; back++) {
    const day = phrase.target.get(addDays(latest.date, -back));
    if (!day) continue;
    impressions += day.impressions;
    weight += day.weight;
  }
  return {
    latest,
    baseline: impressions > 0 ? weight / impressions : null,
    baselineImpressions: impressions,
  };
}

function phraseData(phrase: Phrase, extra: Record<string, unknown>) {
  return { phrase: phrase.query, targetUrl: phrase.targetUrl, ...extra };
}

async function phraseDropped(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const places = params.places ?? 5;
  const minImpressions = params.minImpressions ?? 0;
  return (await loadPhrases(site, evalDate, params.tagId)).flatMap((phrase) => {
    const point = latestAndBaseline(phrase, evalDate);
    if (!point || point.baseline === null) return [];
    if (point.baselineImpressions < minImpressions) return [];
    const drop = point.latest.position - point.baseline;
    if (drop < places) return [];
    return [
      {
        subject: phrase.id,
        date: point.latest.date,
        title: `“${phrase.query}” dropped ${round1(drop)} places`,
        message: `Position ${round1(point.latest.position)} on ${point.latest.date}, against ${round1(point.baseline)} on average the 7 days before. Target: ${phrase.targetUrl}`,
        data: phraseData(phrase, {
          position: round1(point.latest.position),
          baseline: round1(point.baseline),
          change: -round1(drop),
        }),
      },
    ];
  });
}

async function phraseEnteredTop(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const top = params.top ?? 10;
  return (await loadPhrases(site, evalDate, params.tagId)).flatMap((phrase) => {
    const point = latestAndBaseline(phrase, evalDate);
    if (!point || point.baseline === null) return [];
    if (point.latest.position > top || point.baseline <= top) return [];
    return [
      {
        subject: phrase.id,
        date: point.latest.date,
        title: `“${phrase.query}” reached the top ${top}`,
        message: `Position ${round1(point.latest.position)} on ${point.latest.date}, up from ${round1(point.baseline)} on average the 7 days before. Target: ${phrase.targetUrl}`,
        data: phraseData(phrase, {
          position: round1(point.latest.position),
          baseline: round1(point.baseline),
          top,
        }),
      },
    ];
  });
}

async function phraseOutranked(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const days = params.days ?? 2;
  return (await loadPhrases(site, evalDate, params.tagId)).flatMap((phrase) => {
    for (let back = 0; back < days; back++) {
      const date = addDays(evalDate, -back);
      const other = phrase.others.get(date);
      const mine = phrase.target.get(date);
      if (
        !other ||
        !(
          other.clicks > (mine?.clicks ?? 0) ||
          other.impressions > (mine?.impressions ?? 0)
        )
      )
        return [];
    }
    return [
      {
        subject: phrase.id,
        date: evalDate,
        title: `Another page beat the target for “${phrase.query}”`,
        message: `For ${days} day(s) up to ${evalDate}, another page of yours got more clicks or impressions for this phrase than its target ${phrase.targetUrl}.`,
        data: phraseData(phrase, { days }),
      },
    ];
  });
}

async function rankMismatch(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const share = params.share ?? 70;
  const minDays = params.days ?? 5;
  const month = evalDate.slice(0, 7);
  const [phrases, comparison] = await Promise.all([
    loadPhrases(site, evalDate, params.tagId),
    GscTrackerRankLink.getRankComparison({
      site,
      from: `${month}-01`,
      to: evalDate,
    }),
  ]);
  if (!comparison.link) return [];
  return phrases.flatMap((phrase) => {
    const ranks = comparison.keywords[phrase.id];
    if (!ranks?.trackingKeywordId) return [];
    const gscDays: Record<string, { position: number }> = {};
    for (const [date, day] of phrase.target)
      if (date >= `${month}-01` && day.impressions > 0)
        gscDays[date] = { position: day.weight / day.impressions };
    const summary = summarizeRank({
      gscDays,
      rankDays: ranks.days,
      targetUrl: phrase.targetUrl,
    });
    if (summary.compared < minDays) return [];
    const matched = Math.round((summary.agreeing / summary.compared) * 100);
    if (matched >= share) return [];
    return [
      {
        subject: phrase.id,
        // Once a month per phrase.
        date: month,
        title: `Rank Tracking disagrees on “${phrase.query}”`,
        message: `Only ${matched}% of ${summary.compared} days this month are within 10 places of Search Console (${comparison.link?.domain}, ${comparison.link?.device}).`,
        data: phraseData(phrase, {
          matchPercent: matched,
          daysCompared: summary.compared,
          otherUrl: summary.otherUrl,
        }),
      },
    ];
  });
}

async function checkpointReached(
  site: GscTrackerSite,
  evalDate: string,
  params: GscTrackerAlertParams,
): Promise<AlertCandidate[]> {
  const phrases = await loadPhrases(site, evalDate, params.tagId);
  // Checkpoints whose day arrived within the last week.
  const dates = new Set(
    phrases.flatMap((phrase) =>
      phrase.checkpoints.filter(
        (date) => date <= evalDate && date > addDays(evalDate, -7),
      ),
    ),
  );
  return [...dates].map((date) => {
    const lines = phrases
      .filter((phrase) => phrase.checkpoints.includes(date))
      .map((phrase) => {
        const points = markerPoints(phrase.target, phrase.startDate, [date]);
        const start = points.start.point?.position ?? null;
        const reached = points.checkpoints[0]?.point?.position ?? null;
        return {
          phrase: phrase.query,
          start: start === null ? null : round1(start),
          checkpoint: reached === null ? null : round1(reached),
        };
      });
    const text = lines
      .map(
        (line) =>
          `${line.phrase}: ${line.start ?? "–"} → ${line.checkpoint ?? "–"}`,
      )
      .join("; ");
    return {
      subject: `checkpoint ${date}`,
      date,
      title: `Checkpoint ${date} reached (${lines.length} phrase${lines.length === 1 ? "" : "s"})`,
      message: `Start → checkpoint: ${text}`,
      data: { checkpoint: date, phrases: lines },
    };
  });
}

export const PhraseAlerts = {
  phrase_dropped: phraseDropped,
  phrase_entered_top: phraseEnteredTop,
  phrase_outranked: phraseOutranked,
  rank_mismatch: rankMismatch,
  checkpoint_reached: checkpointReached,
};
