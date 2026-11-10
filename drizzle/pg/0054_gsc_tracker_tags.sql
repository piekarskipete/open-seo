CREATE TABLE "gsc_tracker_keyword_tags" (
	"keyword_id" text NOT NULL,
	"tag_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_tracker_keyword_tags" ADD CONSTRAINT "gsc_tracker_keyword_tags_keyword_id_gsc_tracker_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."gsc_tracker_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_keyword_tags" ADD CONSTRAINT "gsc_tracker_keyword_tags_tag_id_gsc_tracker_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."gsc_tracker_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_tags" ADD CONSTRAINT "gsc_tracker_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_keyword_tags_idx" ON "gsc_tracker_keyword_tags" USING btree ("keyword_id","tag_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_keyword_tags_tag_idx" ON "gsc_tracker_keyword_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_tags_project_name_idx" ON "gsc_tracker_tags" USING btree ("project_id","name");