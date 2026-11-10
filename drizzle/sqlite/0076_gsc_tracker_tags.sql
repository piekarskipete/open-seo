CREATE TABLE `gsc_tracker_keyword_tags` (
	`keyword_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`keyword_id`) REFERENCES `gsc_tracker_keywords`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `gsc_tracker_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_keyword_tags_idx` ON `gsc_tracker_keyword_tags` (`keyword_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `gsc_tracker_keyword_tags_tag_idx` ON `gsc_tracker_keyword_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `gsc_tracker_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gsc_tracker_tags_project_name_idx` ON `gsc_tracker_tags` (`project_id`,`name`);