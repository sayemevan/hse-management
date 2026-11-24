CREATE TABLE `user_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_project_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`level` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`code` text,
	`description` text,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`deactivated_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `place_project_parent_idx` ON `place` (`project_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `place_project_level_idx` ON `place` (`project_id`,`level`,`active`);--> statement-breakpoint
CREATE TABLE `activity_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_user_id` text,
	`changes` text,
	`snapshot` text,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_entry_project_idx` ON `activity_entry` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_entry_entity_idx` ON `activity_entry` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`type` text NOT NULL,
	`params` text NOT NULL,
	`actor_user_id` text,
	`project_id` text,
	`entity_type` text,
	`entity_id` text,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `notification_recipient_created_idx` ON `notification` (`recipient_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_recipient_unread_idx` ON `notification` (`recipient_user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_created_idx` ON `notification` (`created_at`);