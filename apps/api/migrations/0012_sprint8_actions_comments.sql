CREATE TABLE `action` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`source_module` text NOT NULL,
	`source_record_id` text,
	`source_label` text NOT NULL,
	`type` text NOT NULL,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`search_key` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`due_on` text NOT NULL,
	`area_id` text,
	`location_id` text,
	`work_zone_id` text,
	`progress_percent` integer,
	`started_at` integer,
	`completed_at` integer,
	`completed_on_time` integer,
	`verified_at` integer,
	`verified_by` text,
	`verification_method` text,
	`closed_at` integer,
	`closed_by` text,
	`send_back_count` integer DEFAULT 0 NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_zone_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_number_unique` ON `action` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `action_project_status_idx` ON `action` (`project_id`,`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `action_owner_idx` ON `action` (`company_id`,`owner_id`,`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `action_source_idx` ON `action` (`project_id`,`source_module`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `action_due_idx` ON `action` (`status`,`due_on`);--> statement-breakpoint
CREATE INDEX `action_area_idx` ON `action` (`area_id`);--> statement-breakpoint
CREATE INDEX `action_location_idx` ON `action` (`location_id`);--> statement-breakpoint
CREATE INDEX `action_work_zone_idx` ON `action` (`work_zone_id`);--> statement-breakpoint
CREATE TABLE `action_collaborator` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	`added_by` text,
	`removed_at` integer,
	`removed_by` text,
	FOREIGN KEY (`action_id`) REFERENCES `action`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `action_collaborator_action_idx` ON `action_collaborator` (`action_id`,`removed_at`);--> statement-breakpoint
CREATE INDEX `action_collaborator_user_idx` ON `action_collaborator` (`user_id`,`removed_at`);--> statement-breakpoint
CREATE TABLE `action_file` (
	`action_id` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`action_id`, `file_id`),
	FOREIGN KEY (`action_id`) REFERENCES `action`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `action_owner_history` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`from_at` integer NOT NULL,
	`to_at` integer,
	`assigned_by` text,
	`reason` text,
	FOREIGN KEY (`action_id`) REFERENCES `action`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `action_owner_history_action_idx` ON `action_owner_history` (`action_id`,`from_at`);--> statement-breakpoint
CREATE TABLE `action_update` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`percent` integer,
	`method` text,
	`file_ids` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`action_id`) REFERENCES `action`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `action_update_action_idx` ON `action_update` (`action_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `record_counter` (
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`next_value` integer NOT NULL,
	PRIMARY KEY(`project_id`, `kind`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer
);
--> statement-breakpoint
CREATE INDEX `comment_entity_idx` ON `comment` (`entity_type`,`entity_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `comment_author_idx` ON `comment` (`author_id`,`created_at`);