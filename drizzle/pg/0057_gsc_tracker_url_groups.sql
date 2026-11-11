CREATE TABLE "gsc_tracker_page_days" (
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"date" text NOT NULL,
	"page_id" integer NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_url_group_members" (
	"group_id" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"excluded" integer DEFAULT 0 NOT NULL,
	"added_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_url_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"pattern" text,
	"scanned_page_id" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" text,
	"last_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_tracker_sites" ADD COLUMN "pages_oldest_date" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_sites" ADD COLUMN "pages_newest_date" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_sites" ADD COLUMN "pages_synced_at" text;--> statement-breakpoint
ALTER TABLE "gsc_tracker_page_days" ADD CONSTRAINT "gsc_tracker_page_days_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_page_days" ADD CONSTRAINT "gsc_tracker_page_days_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_page_days" ADD CONSTRAINT "gsc_tracker_page_days_page_id_gsc_tracker_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."gsc_tracker_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_url_group_members" ADD CONSTRAINT "gsc_tracker_url_group_members_group_id_gsc_tracker_url_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."gsc_tracker_url_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_url_groups" ADD CONSTRAINT "gsc_tracker_url_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_url_groups" ADD CONSTRAINT "gsc_tracker_url_groups_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_page_days_day_idx" ON "gsc_tracker_page_days" USING btree ("site_id","date","page_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_page_days_page_idx" ON "gsc_tracker_page_days" USING btree ("site_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_url_group_members_idx" ON "gsc_tracker_url_group_members" USING btree ("group_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_url_groups_site_name_idx" ON "gsc_tracker_url_groups" USING btree ("site_id","name");