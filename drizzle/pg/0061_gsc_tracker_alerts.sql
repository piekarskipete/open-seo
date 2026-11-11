CREATE TABLE "gsc_tracker_alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"site_id" text NOT NULL,
	"subject" text NOT NULL,
	"date" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"type" text NOT NULL,
	"params" text DEFAULT '{}' NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"cooldown_days" integer DEFAULT 3 NOT NULL,
	"last_evaluated_date" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_tracker_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"format" text DEFAULT 'json' NOT NULL,
	"mode" text DEFAULT 'instant' NOT NULL,
	"last_status" integer,
	"last_error" text,
	"last_sent_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsc_tracker_alert_events" ADD CONSTRAINT "gsc_tracker_alert_events_rule_id_gsc_tracker_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."gsc_tracker_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_alert_events" ADD CONSTRAINT "gsc_tracker_alert_events_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_alert_rules" ADD CONSTRAINT "gsc_tracker_alert_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_alert_rules" ADD CONSTRAINT "gsc_tracker_alert_rules_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_alert_rules" ADD CONSTRAINT "gsc_tracker_alert_rules_webhook_id_gsc_tracker_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."gsc_tracker_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_webhooks" ADD CONSTRAINT "gsc_tracker_webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_tracker_webhooks" ADD CONSTRAINT "gsc_tracker_webhooks_site_id_gsc_tracker_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."gsc_tracker_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_tracker_alert_events_rule_subject_date_idx" ON "gsc_tracker_alert_events" USING btree ("rule_id","subject","date");--> statement-breakpoint
CREATE INDEX "gsc_tracker_alert_events_site_idx" ON "gsc_tracker_alert_events" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "gsc_tracker_alert_rules_site_idx" ON "gsc_tracker_alert_rules" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "gsc_tracker_webhooks_site_idx" ON "gsc_tracker_webhooks" USING btree ("site_id");