import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Mirrors src/db/gsc-tracker.schema.ts; see the comments there.

export const gscTrackerProjects = pgTable(
  "gsc_tracker_projects",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    oldestDate: text("oldest_date"),
    newestDate: text("newest_date"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    enabledByUserId: text("enabled_by_user_id").notNull(),
    // How positions are shown: "decimal" (7.4) or "whole" (7).
    positionFormat: text("position_format").notNull().default("decimal"),
    // Query Explorer's default order: "clicks", "impressions", "ctr" or
    // "position".
    explorerSort: text("explorer_sort").notNull().default("clicks"),
    // How day labels read: "dd.mm" (03.10) or "mon-d" (Oct 3).
    dateFormat: text("date_format").notNull().default("dd.mm"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [index("gsc_tracker_projects_org_idx").on(table.organizationId)],
);

export const gscTrackerQueries = pgTable(
  "gsc_tracker_queries",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_queries_project_query_idx").on(
      table.projectId,
      table.query,
    ),
  ],
);

export const gscTrackerPages = pgTable(
  "gsc_tracker_pages",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_pages_project_url_idx").on(
      table.projectId,
      table.url,
    ),
  ],
);

export const gscTrackerRows = pgTable(
  "gsc_tracker_rows",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    queryId: integer("query_id")
      .notNull()
      .references(() => gscTrackerQueries.id, { onDelete: "cascade" }),
    pageId: integer("page_id")
      .notNull()
      .references(() => gscTrackerPages.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_rows_day_idx").on(
      table.projectId,
      table.date,
      table.queryId,
      table.pageId,
    ),
    index("gsc_tracker_rows_query_idx").on(table.projectId, table.queryId),
    index("gsc_tracker_rows_page_idx").on(table.projectId, table.pageId),
  ],
);

export const gscTrackerTotals = pgTable(
  "gsc_tracker_totals",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_totals_day_idx").on(table.projectId, table.date),
  ],
);

// Phrases the project follows, each with the URL that should rank for it.
// Stored lowercased, as Search Console reports queries.
export const gscTrackerKeywords = pgTable(
  "gsc_tracker_keywords",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    targetUrl: text("target_url").notNull(),
    // The day progress is measured from; null means the day it was added.
    startDate: text("start_date"),
    // Up to two days to measure progress up to, earliest first.
    checkpoint1Date: text("checkpoint1_date"),
    checkpoint2Date: text("checkpoint2_date"),
    // The fetched day range, both ends inclusive; null until the first day.
    oldestDate: text("oldest_date"),
    newestDate: text("newest_date"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    // A phrase can be followed for several target URLs, each its own entry.
    uniqueIndex("gsc_tracker_keywords_project_query_target_idx").on(
      table.projectId,
      table.query,
      table.targetUrl,
    ),
  ],
);

// One day of a followed phrase on one page: every page Search Console showed
// for the phrase that day, so competing pages can be compared.
export const gscTrackerKeywordDays = pgTable(
  "gsc_tracker_keyword_days",
  {
    keywordId: text("keyword_id")
      .notNull()
      .references(() => gscTrackerKeywords.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    pageId: integer("page_id")
      .notNull()
      .references(() => gscTrackerPages.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_keyword_days_idx").on(
      table.keywordId,
      table.date,
      table.pageId,
    ),
  ],
);

// Labels that group followed phrases. Each project keeps its own, apart from
// Saved Keywords tags; the color is a key from TAG_COLOR_KEYS
// (src/shared/tag-colors.ts).
export const gscTrackerTags = pgTable(
  "gsc_tracker_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("gsc_tracker_tags_project_name_idx").on(
      table.projectId,
      table.name,
    ),
  ],
);

// Which tags a followed phrase carries; a phrase can carry several.
export const gscTrackerKeywordTags = pgTable(
  "gsc_tracker_keyword_tags",
  {
    keywordId: text("keyword_id")
      .notNull()
      .references(() => gscTrackerKeywords.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => gscTrackerTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("gsc_tracker_keyword_tags_idx").on(
      table.keywordId,
      table.tagId,
    ),
    index("gsc_tracker_keyword_tags_tag_idx").on(table.tagId),
  ],
);
