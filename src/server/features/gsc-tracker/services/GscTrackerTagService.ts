import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import {
  GscTrackerRepository,
  type GscTrackerSite,
} from "../repositories/GscTrackerRepository";
import { GscTrackerTagRepository } from "../repositories/GscTrackerTagRepository";
import { GSC_TRACKER_TAG_NAME_MAX } from "@/shared/gsc-tracker";
import { normalizeSavedKeywordTags } from "@/shared/saved-keyword-tags";
import {
  resolveTagColor,
  TAG_COLOR_KEYS,
  type TagColorKey,
} from "@/shared/tag-colors";

// GSC Tracker tags belong to the tracker alone: they share the app's tag
// look (palette, chips, dialogs) but not the Saved Keywords tag list.

// Tags per project; enough to group phrases without a cluttered filter.
const MAX_TAGS = 50;

// Colors stored before the tracker used the app's tag palette.
const EARLIER_COLORS: Record<string, TagColorKey> = {
  gray: "slate",
  red: "rose",
  orange: "amber",
  green: "emerald",
  teal: "emerald",
  blue: "sky",
  pink: "fuchsia",
};

function paletteColor(tag: { id: string; color: string }): TagColorKey {
  const known = TAG_COLOR_KEYS.find((key) => key === tag.color);
  return known ?? EARLIER_COLORS[tag.color] ?? resolveTagColor({ id: tag.id });
}

function cleanName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new AppError("VALIDATION_ERROR", "Name the tag.");
  if (cleaned.length > GSC_TRACKER_TAG_NAME_MAX)
    throw new AppError(
      "VALIDATION_ERROR",
      `Keep tag names under ${GSC_TRACKER_TAG_NAME_MAX} characters.`,
    );
  return cleaned;
}

/** The project's tags with how many phrases carry each, by name. */
async function list(siteId: string) {
  const [tags, assignments] = await Promise.all([
    GscTrackerTagRepository.list(siteId),
    GscTrackerTagRepository.listAssignments(siteId),
  ]);
  const counts = new Map<string, number>();
  for (const { tagId } of assignments)
    counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    normalizedName: tag.name.toLocaleLowerCase(),
    color: paletteColor(tag),
    keywordCount: counts.get(tag.id) ?? 0,
  }));
}

async function update(input: {
  siteId: string;
  id: string;
  name?: string;
  color?: TagColorKey;
}) {
  const tags = await GscTrackerTagRepository.list(input.siteId);
  if (!tags.some((tag) => tag.id === input.id))
    throw new AppError("NOT_FOUND", "That tag no longer exists.");
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (
    name &&
    tags.some(
      (tag) =>
        tag.id !== input.id &&
        tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    throw new AppError("CONFLICT", `A tag named “${name}” already exists.`);
  await GscTrackerTagRepository.update(input.siteId, input.id, {
    name,
    color: input.color,
  });
}

async function remove(siteId: string, id: string) {
  await GscTrackerTagRepository.remove(siteId, id);
}

/**
 * Adds tags (by name, creating the ones the project doesn't have yet) to
 * the given phrases, and takes tags off them. Phrases of other projects
 * are ignored.
 */
async function applyToKeywords(input: {
  siteId: string;
  keywordIds: string[];
  addTags?: string[];
  removeTagIds?: string[];
}) {
  const [tags, keywords] = await Promise.all([
    GscTrackerTagRepository.list(input.siteId),
    GscTrackerKeywordRepository.list(input.siteId),
  ]);
  const own = new Set(keywords.map((keyword) => keyword.id));
  const ids = [...new Set(input.keywordIds)].filter((id) => own.has(id));
  if (ids.length === 0) return { changed: 0 };

  const byName = new Map(
    tags.map((tag) => [tag.name.toLocaleLowerCase(), tag.id]),
  );
  const toAdd: string[] = [];
  let count = tags.length;
  let site: GscTrackerSite | null = null;
  for (const tag of normalizeSavedKeywordTags(input.addTags)) {
    let id = byName.get(tag.normalizedName);
    if (!id) {
      if (count >= MAX_TAGS)
        throw new AppError(
          "VALIDATION_ERROR",
          `A site can have up to ${MAX_TAGS} tags.`,
        );
      site ??= await GscTrackerRepository.get(input.siteId);
      if (!site) throw new AppError("NOT_FOUND", "Tracking is off.");
      const newId = crypto.randomUUID();
      await GscTrackerTagRepository.create({
        id: newId,
        projectId: site.projectId,
        siteId: input.siteId,
        name: cleanName(tag.name),
        color: resolveTagColor({ id: newId }),
      });
      id = newId;
      byName.set(tag.normalizedName, id);
      count += 1;
    }
    toAdd.push(id);
  }
  for (const tagId of toAdd) await GscTrackerTagRepository.assign(tagId, ids);

  const known = new Set(tags.map((tag) => tag.id));
  for (const tagId of new Set(input.removeTagIds ?? []))
    if (known.has(tagId)) await GscTrackerTagRepository.unassign(tagId, ids);
  return { changed: ids.length };
}

/** Tag ids per phrase, for the Keywords tab. */
async function tagsByKeyword(siteId: string): Promise<Map<string, string[]>> {
  const byKeyword = new Map<string, string[]>();
  for (const {
    keywordId,
    tagId,
  } of await GscTrackerTagRepository.listAssignments(siteId)) {
    const ids = byKeyword.get(keywordId) ?? [];
    ids.push(tagId);
    byKeyword.set(keywordId, ids);
  }
  return byKeyword;
}

export const GscTrackerTagService = {
  list,
  update,
  remove,
  applyToKeywords,
  tagsByKeyword,
};
