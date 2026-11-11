CREATE TABLE `gsc_tracker_alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`site_id` text NOT NULL,
	`subject` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`sent_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `gsc_tracker_alert_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `gsc_tracker_sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_alert_events_rule_subject_date_idx` ON `gsc_tracker_alert_events` (`rule_id`,`subject`,`date`);--> statement-breakpoint
CREATE INDEX `gsc_tracker_alert_events_site_idx` ON `gsc_tracker_alert_events` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`site_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`type` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`cooldown_days` integer DEFAULT 3 NOT NULL,
	`last_evaluated_date` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `gsc_tracker_sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `gsc_tracker_webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gsc_tracker_alert_rules_site_idx` ON `gsc_tracker_alert_rules` (`site_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`format` text DEFAULT 'json' NOT NULL,
	`mode` text DEFAULT 'instant' NOT NULL,
	`last_status` integer,
	`last_error` text,
	`last_sent_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `gsc_tracker_sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gsc_tracker_webhooks_site_idx` ON `gsc_tracker_webhooks` (`site_id`);