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
