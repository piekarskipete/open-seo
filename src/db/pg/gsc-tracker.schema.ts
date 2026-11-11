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

// Search Console properties a project tracks, each with its own history,
// phrases, tags and settings. A site reaches Google through the account it
// was added with, or through the project's connection when that is unset.
export const gscTrackerSites = pgTable(
  "gsc_tracker_sites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Verbatim from sites.list, as Search Console matches it.
    siteUrl: text("site_url").notNull(),
    // The Google account or service account the site was added with, and
    // the member whose grant it is. Null: the project's connection.
    gscAccountId: text("gsc_account_id"),
    serviceAccountId: text("service_account_id"),
    connectedByUserId: text("connected_by_user_id"),
    connectedAccountEmail: text("connected_account_email"),
    // The stored range, both ends inclusive. Null until the first day lands.
    oldestDate: text("oldest_date"),
    newestDate: text("newest_date"),
    lastSyncedAt: text("last_synced_at"),
    lastError: text("last_error"),
    // Per-page daily history (gsc_tracker_page_days), fetched apart from the
    // query/page rows: its own stored range, both ends inclusive.
    pagesOldestDate: text("pages_oldest_date"),
    pagesNewestDate: text("pages_newest_date"),
    pagesSyncedAt: text("pages_synced_at"),
    enabledByUserId: text("enabled_by_user_id").notNull(),
    positionFormat: text("position_format").notNull().default("decimal"),
    explorerSort: text("explorer_sort").notNull().default("clicks"),
    dateFormat: text("date_format").notNull().default("dd.mm"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("gsc_tracker_sites_project_site_idx").on(
      table.projectId,
      table.siteUrl,
    ),
    index("gsc_tracker_sites_org_idx").on(table.organizationId),
  ],
);

export const gscTrackerQueries = pgTable(
  "gsc_tracker_queries",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
    query: text("query").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_queries_site_query_idx").on(
      table.siteId,
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
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
    url: text("url").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_pages_site_url_idx").on(table.siteId, table.url),
  ],
);

export const gscTrackerRows = pgTable(
  "gsc_tracker_rows",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
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
      table.siteId,
      table.date,
      table.queryId,
      table.pageId,
    ),
    index("gsc_tracker_rows_query_idx").on(table.siteId, table.queryId),
    index("gsc_tracker_rows_page_idx").on(table.siteId, table.pageId),
  ],
);

export const gscTrackerTotals = pgTable(
  "gsc_tracker_totals",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
    date: text("date").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_totals_day_idx").on(table.siteId, table.date),
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
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
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
    uniqueIndex("gsc_tracker_keywords_site_query_target_idx").on(
      table.siteId,
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
    // The tracked site the row belongs to. Nullable only because SQLite
    // can't add a NOT NULL column with a foreign key in place; always set.
    siteId: text("site_id").references(() => gscTrackerSites.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("gsc_tracker_tags_site_name_idx").on(table.siteId, table.name),
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

// One day's clicks, impressions and average position for a page, from a
// page-only query: unlike the query/page rows it includes anonymized
// queries, so a page's and a group's totals add up.
export const gscTrackerPageDays = pgTable(
  "gsc_tracker_page_days",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => gscTrackerSites.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    pageId: integer("page_id")
      .notNull()
      .references(() => gscTrackerPages.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (table) => [
    uniqueIndex("gsc_tracker_page_days_day_idx").on(
      table.siteId,
      table.date,
      table.pageId,
    ),
    index("gsc_tracker_page_days_page_idx").on(table.siteId, table.pageId),
  ],
);

// Groups of page URLs a site follows together. A group's URLs are picked by
// hand, or kept up to date by a rule: a sitemap's URLs, the pages under a
// directory, or the pages matching a regular expression.
export const gscTrackerUrlGroups = pgTable(
  "gsc_tracker_url_groups",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => gscTrackerSites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // "manual", "sitemap", "directory" or "regex" (GSC_TRACKER_GROUP_KINDS).
    kind: text("kind").notNull(),
    // The sitemap URL, directory or expression; null for a manual group.
    pattern: text("pattern"),
    // The highest gsc_tracker_pages id a directory or regex rule has
    // checked, so each refresh only looks at pages seen since.
    scannedPageId: integer("scanned_page_id").notNull().default(0),
    lastRefreshedAt: text("last_refreshed_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("gsc_tracker_url_groups_site_name_idx").on(
      table.siteId,
      table.name,
    ),
  ],
);

// The URLs of a group. A URL removed from a rule group stays as an excluded
// row, so the next refresh doesn't add it back.
export const gscTrackerUrlGroupMembers = pgTable(
  "gsc_tracker_url_group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => gscTrackerUrlGroups.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // "manual" or "rule".
    source: text("source").notNull(),
    excluded: integer("excluded").notNull().default(0),
    addedAt: text("added_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("gsc_tracker_url_group_members_idx").on(
      table.groupId,
      table.url,
    ),
  ],
);
