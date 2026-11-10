import { AppError } from "@/server/lib/errors";
import { GscTrackerKeywordRepository } from "../repositories/GscTrackerKeywordRepository";
import { GscTrackerTagRepository } from "../repositories/GscTrackerTagRepository";
import {
  GSC_TRACKER_TAG_NAME_MAX,
  type GscTrackerTagColor,
} from "@/shared/gsc-tracker";

// Tags per project; enough to group phrases without a cluttered filter.
const MAX_TAGS = 50;

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

/** Throws when another tag of the project already has this name. */
function assertUniqueName(
  tags: { id: string; name: string }[],
  name: string,
  exceptId?: string,
) {
  const taken = tags.some(
    (tag) =>
      tag.id !== exceptId && tag.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken)
    throw new AppError("CONFLICT", `A tag named “${name}” already exists.`);
}

async function list(projectId: string) {
  const [tags, assignments] = await Promise.all([
    GscTrackerTagRepository.list(projectId),
    GscTrackerTagRepository.listAssignments(projectId),
  ]);
  const counts = new Map<string, number>();
  for (const { tagId } of assignments)
    counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    phrases: counts.get(tag.id) ?? 0,
  }));
}

async function create(input: {
  projectId: string;
  name: string;
  color: GscTrackerTagColor;
}) {
  const name = cleanName(input.name);
  const tags = await GscTrackerTagRepository.list(input.projectId);
  if (tags.length >= MAX_TAGS)
    throw new AppError(
      "VALIDATION_ERROR",
      `A project can have up to ${MAX_TAGS} tags.`,
    );
  assertUniqueName(tags, name);
  const id = await GscTrackerTagRepository.create({
    projectId: input.projectId,
    name,
    color: input.color,
  });
  return { id };
}

async function update(input: {
  projectId: string;
  id: string;
  name?: string;
  color?: GscTrackerTagColor;
}) {
  const tags = await GscTrackerTagRepository.list(input.projectId);
  if (!tags.some((tag) => tag.id === input.id))
    throw new AppError("NOT_FOUND", "That tag no longer exists.");
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name) assertUniqueName(tags, name, input.id);
  await GscTrackerTagRepository.update(input.projectId, input.id, {
    name,
    color: input.color,
  });
}

async function remove(projectId: string, id: string) {
  await GscTrackerTagRepository.remove(projectId, id);
}

/** Adds a tag to, or takes it off, the given phrases of the project. */
async function setOnKeywords(input: {
  projectId: string;
  tagId: string;
  keywordIds: string[];
  action: "add" | "remove";
}) {
  const [tags, keywords] = await Promise.all([
    GscTrackerTagRepository.list(input.projectId),
    GscTrackerKeywordRepository.list(input.projectId),
  ]);
  if (!tags.some((tag) => tag.id === input.tagId))
    throw new AppError("NOT_FOUND", "That tag no longer exists.");
  const own = new Set(keywords.map((keyword) => keyword.id));
  const ids = [...new Set(input.keywordIds)].filter((id) => own.has(id));
  if (input.action === "add")
    await GscTrackerTagRepository.assign(input.tagId, ids);
  else await GscTrackerTagRepository.unassign(input.tagId, ids);
  return { changed: ids.length };
}

/** Tag ids per phrase, for the Keywords tab. */
async function tagsByKeyword(
  projectId: string,
): Promise<Map<string, string[]>> {
  const byKeyword = new Map<string, string[]>();
  for (const {
    keywordId,
    tagId,
  } of await GscTrackerTagRepository.listAssignments(projectId)) {
    const ids = byKeyword.get(keywordId) ?? [];
    ids.push(tagId);
    byKeyword.set(keywordId, ids);
  }
  return byKeyword;
}

export const GscTrackerTagService = {
  list,
  create,
  update,
  remove,
  setOnKeywords,
  tagsByKeyword,
};
