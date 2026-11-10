CREATE TABLE `gsc_tracker_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_pages_project_url_idx` ON `gsc_tracker_pages` (`project_id`,`url`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_url` text NOT NULL,
	`oldest_date` text,
	`newest_date` text,
	`last_synced_at` text,
	`last_error` text,
	`enabled_by_user_id` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gsc_tracker_projects_org_idx` ON `gsc_tracker_projects` (`organization_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_queries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`query` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_queries_project_query_idx` ON `gsc_tracker_queries` (`project_id`,`query`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_rows` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`query_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`query_id`) REFERENCES `gsc_tracker_queries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `gsc_tracker_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_rows_day_idx` ON `gsc_tracker_rows` (`project_id`,`date`,`query_id`,`page_id`);--> statement-breakpoint
CREATE INDEX `gsc_tracker_rows_query_idx` ON `gsc_tracker_rows` (`project_id`,`query_id`);--> statement-breakpoint
CREATE INDEX `gsc_tracker_rows_page_idx` ON `gsc_tracker_rows` (`project_id`,`page_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_totals` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_totals_day_idx` ON `gsc_tracker_totals` (`project_id`,`date`);