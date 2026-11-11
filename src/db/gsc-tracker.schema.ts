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
    // Per-page daily history (gsc_tracker_page_days), fetched apart from the
    // query/page rows: its own stored range, both ends inclusive.
    pagesOldestDate: text("pages_oldest_date"),
    pagesNewestDate: text("pages_newest_date"),
    pagesSyncedAt: text("pages_synced_at"),
    enabledByUserId: text("enabled_by_user_id").notNull(),
    positionFormat: text("position_format").notNull().default("decimal"),
    explorerSort: text("explorer_sort").notNull().default("clicks"),
    dateFormat: text("date_format").notNull().default("dd.mm"),
    // The Overview tab's widgets as JSON (GscTrackerWidget[]); null: the
    // default layout.
    overviewLayout: text("overview_layout"),
    // URLs Cannibalization leaves out, as JSON (GscTrackerExclusion[]).
    cannibalExclusions: text("cannibal_exclusions"),
    // The Rank Tracking domain (rank_tracking_configs.id) whose positions the
    // followed phrases are compared with, and the device read from it. No
    // foreign key: a removed domain just reads as unlinked.
    rankConfigId: text("rank_config_id"),
    rankDevice: text("rank_device"),
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

// One day's clicks, impressions and average position for a page, from a
// page-only query: unlike the query/page rows it includes anonymized
// queries, so a page's and a group's totals add up.
export const gscTrackerPageDays = sqliteTable(
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
export const gscTrackerUrlGroups = sqliteTable(
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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
export const gscTrackerUrlGroupMembers = sqliteTable(
  "gsc_tracker_url_group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => gscTrackerUrlGroups.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // "manual" or "rule".
    source: text("source").notNull(),
    excluded: integer("excluded").notNull().default(0),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gsc_tracker_url_group_members_idx").on(
      table.groupId,
      table.url,
    ),
  ],
);

// Where a site's alerts go: a URL that receives a POST per alert ("instant")
// or one per check with all of them ("digest"), signed with the secret when
// set. "json", "slack" or "discord" decides the body.
export const gscTrackerWebhooks = sqliteTable(
  "gsc_tracker_webhooks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => gscTrackerSites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    format: text("format").notNull().default("json"),
    mode: text("mode").notNull().default("instant"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    lastSentAt: text("last_sent_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("gsc_tracker_webhooks_site_idx").on(table.siteId)],
);

// What a site watches for: a type from GSC_TRACKER_ALERT_TYPES with its
// thresholds and scope as JSON, sent to one webhook.
export const gscTrackerAlertRules = sqliteTable(
  "gsc_tracker_alert_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => gscTrackerSites.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => gscTrackerWebhooks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    params: text("params").notNull().default("{}"),
    active: integer("active").notNull().default(1),
    // Days before the same rule alerts about the same thing again.
    cooldownDays: integer("cooldown_days").notNull().default(3),
    // The newest data day the rule has looked at.
    lastEvaluatedDate: text("last_evaluated_date"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("gsc_tracker_alert_rules_site_idx").on(table.siteId)],
);

// Alerts raised, once per rule, subject (a phrase, a group, a URL…) and day,
// with how their delivery went.
export const gscTrackerAlertEvents = sqliteTable(
  "gsc_tracker_alert_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => gscTrackerAlertRules.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => gscTrackerSites.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    date: text("date").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    data: text("data").notNull().default("{}"),
    // "pending", "sent" or "failed".
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    sentAt: text("sent_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("gsc_tracker_alert_events_rule_subject_date_idx").on(
      table.ruleId,
      table.subject,
      table.date,
    ),
    index("gsc_tracker_alert_events_site_idx").on(table.siteId, table.status),
  ],
);
