CREATE TABLE "gsc_tracker_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"site_url" text NOT NULL,
	"oldest_date" text,
	"newest_date" text,
	"last_synced_at" text,
	"last_error" text,
	"enabled_by_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"query" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_rows" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"query_id" integer NOT NULL,
	"page_id" integer NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_totals" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_tracker_pages" ADD CONSTRAINT "gsc_tracker_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_projects" ADD CONSTRAINT "gsc_tracker_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_projects" ADD CONSTRAINT "gsc_tracker_projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_queries" ADD CONSTRAINT "gsc_tracker_queries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_rows" ADD CONSTRAINT "gsc_tracker_rows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_rows" ADD CONSTRAINT "gsc_tracker_rows_query_id_gsc_tracker_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."gsc_tracker_queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_rows" ADD CONSTRAINT "gsc_tracker_rows_page_id_gsc_tracker_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."gsc_tracker_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_totals" ADD CONSTRAINT "gsc_tracker_totals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_pages_project_url_idx" ON "gsc_tracker_pages" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "gsc_tracker_projects_org_idx" ON "gsc_tracker_projects" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_queries_project_query_idx" ON "gsc_tracker_queries" USING btree ("project_id","query");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_rows_day_idx" ON "gsc_tracker_rows" USING btree ("project_id","date","query_id","page_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_rows_query_idx" ON "gsc_tracker_rows" USING btree ("project_id","query_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_rows_page_idx" ON "gsc_tracker_rows" USING btree ("project_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_totals_day_idx" ON "gsc_tracker_totals" USING btree ("project_id","date");