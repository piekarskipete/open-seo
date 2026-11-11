CREATE TABLE `gsc_tracker_page_days` (
	`project_id` text NOT NULL,
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`page_id` integer NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `gsc_tracker_sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `gsc_tracker_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_page_days_day_idx` ON `gsc_tracker_page_days` (`site_id`,`date`,`page_id`);--> statement-breakpoint
CREATE INDEX `gsc_tracker_page_days_page_idx` ON `gsc_tracker_page_days` (`site_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_url_group_members` (
	`group_id` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`excluded` integer DEFAULT 0 NOT NULL,
	`added_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `gsc_tracker_url_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_url_group_members_idx` ON `gsc_tracker_url_group_members` (`group_id`,`url`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_url_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`pattern` text,
	`scanned_page_id` integer DEFAULT 0 NOT NULL,
	`last_refreshed_at` text,
	`last_error` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `gsc_tracker_sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_url_groups_site_name_idx` ON `gsc_tracker_url_groups` (`site_id`,`name`);--> statement-breakpoint
ALTER TABLE `gsc_tracker_sites` ADD `pages_oldest_date` text;--> statement-breakpoint
ALTER TABLE `gsc_tracker_sites` ADD `pages_newest_date` text;--> statement-breakpoint
ALTER TABLE `gsc_tracker_sites` ADD `pages_synced_at` text;