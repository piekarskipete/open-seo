CREATE TABLE "gsc_tracker_keyword_days" (
	"keyword_id" text NOT NULL,
	"date" text NOT NULL,
	"page_id" integer NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"query" text NOT NULL,
	"target_url" text NOT NULL,
	"oldest_date" text,
	"newest_date" text,
	"last_synced_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_tracker_projects" ADD COLUMN "position_format" text DEFAULT 'decimal' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_tracker_keyword_days" ADD CONSTRAINT "gsc_tracker_keyword_days_keyword_id_gsc_tracker_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."gsc_tracker_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_keyword_days" ADD CONSTRAINT "gsc_tracker_keyword_days_page_id_gsc_tracker_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."gsc_tracker_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_keywords" ADD CONSTRAINT "gsc_tracker_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_keyword_days_idx" ON "gsc_tracker_keyword_days" USING btree ("keyword_id","date","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_keywords_project_query_idx" ON "gsc_tracker_keywords" USING btree ("project_id","query");