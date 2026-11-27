CREATE TABLE `inspection` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`status` text NOT NULL,
	`cancelled_at` integer,
	`cancelled_by` text,
	`cancel_reason` text,
	`inspector_id` text NOT NULL,
	`planned_by` text,
	`planned_on` text,
	`note` text,
	`area_id` text,
	`location_id` text,
	`work_zone_id` text,
	`inspected_on` text,
	`weather` text,
	`notes` text,
	`latitude` real,
	`longitude` real,
	`location_accuracy_m` real,
	`started_at` integer,
	`submitted_at` integer,
	`submit_count` integer DEFAULT 0 NOT NULL,
	`review_started_at` integer,
	`review_started_by` text,
	`approved_at` integer,
	`approved_by` text,
	`approved_on_submit` integer DEFAULT false NOT NULL,
	`closed_at` integer,
	`score_percent` real,
	`score_outcome` text,
	`follow_up_of` text,
	`offline` integer DEFAULT false NOT NULL,
	`device_id` text,
	`captured_at` integer,
	`received_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `inspection_template`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_version_id`) REFERENCES `inspection_template_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_zone_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_number_unique` ON `inspection` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `inspection_project_status_idx` ON `inspection` (`project_id`,`status`,`planned_on`);--> statement-breakpoint
CREATE INDEX `inspection_inspector_idx` ON `inspection` (`company_id`,`inspector_id`,`status`);--> statement-breakpoint
CREATE INDEX `inspection_template_idx` ON `inspection` (`project_id`,`template_id`);--> statement-breakpoint
CREATE INDEX `inspection_version_idx` ON `inspection` (`template_version_id`);--> statement-breakpoint
CREATE INDEX `inspection_open_idx` ON `inspection` (`status`,`planned_on`);--> statement-breakpoint
CREATE INDEX `inspection_area_idx` ON `inspection` (`area_id`);--> statement-breakpoint
CREATE INDEX `inspection_location_idx` ON `inspection` (`location_id`);--> statement-breakpoint
CREATE INDEX `inspection_work_zone_idx` ON `inspection` (`work_zone_id`);--> statement-breakpoint
CREATE TABLE `inspection_category` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name_en` text,
	`name_ar` text,
	`name_key_en` text,
	`name_key_ar` text,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`seed_key` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `inspection_category_company_idx` ON `inspection_category` (`company_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_category_seed_unique` ON `inspection_category` (`company_id`,`seed_key`);--> statement-breakpoint
CREATE TABLE `inspection_file` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_key` text,
	`file_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	`submitted_with` integer,
	`removed_at` integer,
	`removed_by` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspection`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inspection_file_item_idx` ON `inspection_file` (`inspection_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `inspection_finding` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_key` text NOT NULL,
	`seq` integer NOT NULL,
	`description` text NOT NULL,
	`severity` text NOT NULL,
	`category_en` text,
	`category_ar` text,
	`responsible_id` text,
	`due_on` text NOT NULL,
	`status` text NOT NULL,
	`decision` text,
	`no_action_reason` text,
	`edited_by` text,
	`edited_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspection`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_finding_item_unique` ON `inspection_finding` (`inspection_id`,`item_key`);--> statement-breakpoint
CREATE INDEX `inspection_finding_project_idx` ON `inspection_finding` (`project_id`,`status`,`severity`);--> statement-breakpoint
CREATE TABLE `inspection_item_result` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`inspection_id` text NOT NULL,
	`item_key` text NOT NULL,
	`result` text,
	`comment` text,
	`priority` text,
	`assigned_to` text,
	`raise_finding` integer DEFAULT false NOT NULL,
	`captured_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`inspection_id`) REFERENCES `inspection`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_item_unique` ON `inspection_item_result` (`inspection_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `inspection_template` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name_en` text,
	`name_ar` text,
	`name_key_en` text,
	`name_key_ar` text,
	`status` text NOT NULL,
	`current_version_id` text,
	`retired_at` integer,
	`retired_by` text,
	`seed_key` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`category_id`) REFERENCES `inspection_category`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inspection_template_company_idx` ON `inspection_template` (`company_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_template_seed_unique` ON `inspection_template` (`company_id`,`seed_key`);--> statement-breakpoint
CREATE TABLE `inspection_template_version` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`template_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`state` text NOT NULL,
	`content` text NOT NULL,
	`item_count` integer NOT NULL,
	`published_at` integer,
	`published_by` text,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`template_id`) REFERENCES `inspection_template`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_template_version_no_unique` ON `inspection_template_version` (`template_id`,`version_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `inspection_template_one_draft` ON `inspection_template_version` (`template_id`) WHERE state = 'draft';