import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// GSC Tracker: a project's Search Console history kept in OpenSEO, so trends
// reach past what one live query shows and stay available offline from
// Google. Dates are Search Console's own (Pacific time), as YYYY-MM-DD text.

// Search Console properties a project tracks, each with its own history,
// phrases, tags and settings. A site reaches Google through the account it
// was added with, or through the project's connection when that is unset.
export const gscTrackerSites = sqliteTable(
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
    enabledByUserId: text("enabled_by_user_id").notNull(),
    positionFormat: text("position_format").notNull().default("decimal"),
    explorerSort: text("explorer_sort").notNull().default("clicks"),
    dateFormat: text("date_format").notNull().default("dd.mm"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gsc_tracker_sites_project_site_idx").on(
      table.projectId,
      table.siteUrl,
    ),
    index("gsc_tracker_sites_org_idx").on(table.organizationId),
  ],
);

// Queries and page URLs are stored once per project; daily rows point at them.
export const gscTrackerQueries = sqliteTable(
  "gsc_tracker_queries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

export const gscTrackerPages = sqliteTable(
  "gsc_tracker_pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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

// One day's clicks, impressions and average position for a query on a page.
// Only the day's top rows are kept (see the tracker's row cap), so totals come
// from gsc_tracker_totals, not from summing these.
export const gscTrackerRows = sqliteTable(
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

// The property's whole-day totals, which include the anonymized queries the
// query/page rows leave out.
export const gscTrackerTotals = sqliteTable(
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
export const gscTrackerKeywords = sqliteTable(
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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
export const gscTrackerKeywordDays = sqliteTable(
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
export const gscTrackerTags = sqliteTable(
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gsc_tracker_tags_site_name_idx").on(table.siteId, table.name),
  ],
);

// Which tags a followed phrase carries; a phrase can carry several.
export const gscTrackerKeywordTags = sqliteTable(
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
