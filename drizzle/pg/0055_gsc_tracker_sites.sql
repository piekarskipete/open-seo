CREATE TABLE "gsc_tracker_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"site_url" text NOT NULL,
	"gsc_account_id" text,
	"service_account_id" text,
	"connected_by_user_id" text,
	"connected_account_email" text,
	"oldest_date" text,
	"newest_date" text,
	"last_synced_at" text,
	"last_error" text,
	"enabled_by_user_id" text NOT NULL,
	"position_format" text DEFAULT 'decimal' NOT NULL,
	"explorer_sort" text DEFAULT 'clicks' NOT NULL,
	"date_format" text DEFAULT 'dd.mm' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
DROP INDEX "gsc_tracker_keywords_project_query_target_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_pages_project_url_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_queries_project_query_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_tags_project_name_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_rows_day_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_rows_query_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_rows_page_idx";--> statement-breakpoint
DROP INDEX "gsc_tracker_totals_day_idx";--> statement-breakpoint
ALTER TABLE "gsc_tracker_keywords" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_pages" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_queries" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_rows" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_tags" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_totals" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_sites" ADD CONSTRAINT "gsc_tracker_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_sites" ADD CONSTRAINT "gsc_tracker_sites_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_sites_project_site_idx" ON "gsc_tracker_sites" USING btree ("project_id","site_url");--> statement-breakpoint
CREATE INDEX "gsc_tracker_sites_org_idx" ON "gsc_tracker_sites" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "gsc_tracker_keywords" ADD CONSTRAINT "gsc_tracker_keywords_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_pages" ADD CONSTRAINT "gsc_tracker_pages_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_queries" ADD CONSTRAINT "gsc_tracker_queries_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_rows" ADD CONSTRAINT "gsc_tracker_rows_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_tags" ADD CONSTRAINT "gsc_tracker_tags_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_totals" ADD CONSTRAINT "gsc_tracker_totals_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_keywords_site_query_target_idx" ON "gsc_tracker_keywords" USING btree ("site_id","query","target_url");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_pages_site_url_idx" ON "gsc_tracker_pages" USING btree ("site_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_queries_site_query_idx" ON "gsc_tracker_queries" USING btree ("site_id","query");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_tags_site_name_idx" ON "gsc_tracker_tags" USING btree ("site_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_rows_day_idx" ON "gsc_tracker_rows" USING btree ("site_id","date","query_id","page_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_rows_query_idx" ON "gsc_tracker_rows" USING btree ("site_id","query_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_rows_page_idx" ON "gsc_tracker_rows" USING btree ("site_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_totals_day_idx" ON "gsc_tracker_totals" USING btree ("site_id","date");--> statement-breakpoint
-- Each project's existing tracker becomes its first site, with the project's id
-- as the site id. It keeps reaching Google through the project's connection
-- (no account of its own), and its stored rows move under it.
INSERT INTO "gsc_tracker_sites" ("id", "project_id", "organization_id", "site_url", "oldest_date", "newest_date", "last_synced_at", "last_error", "enabled_by_user_id", "position_format", "explorer_sort", "date_format", "created_at", "updated_at")
SELECT "project_id", "project_id", "organization_id", "site_url", "oldest_date", "newest_date", "last_synced_at", "last_error", "enabled_by_user_id", "position_format", "explorer_sort", "date_format", "created_at", "updated_at" FROM "gsc_tracker_projects";--> statement-breakpoint
UPDATE "gsc_tracker_keywords" SET "site_id" = "project_id";--> statement-breakpoint
UPDATE "gsc_tracker_pages" SET "site_id" = "project_id";--> statement-breakpoint
UPDATE "gsc_tracker_queries" SET "site_id" = "project_id";--> statement-breakpoint
UPDATE "gsc_tracker_rows" SET "site_id" = "project_id";--> statement-breakpoint
UPDATE "gsc_tracker_tags" SET "site_id" = "project_id";--> statement-breakpoint
UPDATE "gsc_tracker_totals" SET "site_id" = "project_id";
