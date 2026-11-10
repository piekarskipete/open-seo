CREATE TABLE `gsc_tracker_keyword_days` (
	`keyword_id` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `gsc_tracker_keywords`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `gsc_tracker_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_keyword_days_idx` ON `gsc_tracker_keyword_days` (`keyword_id`,`date`,`page_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`query` text NOT NULL,
	`target_url` text NOT NULL,
	`oldest_date` text,
	`newest_date` text,
	`last_synced_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_keywords_project_query_idx` ON `gsc_tracker_keywords` (`project_id`,`query`);--> statement-breakpoint
ALTER TABLE `gsc_tracker_projects` ADD `position_format` text DEFAULT 'decimal' NOT NULL;