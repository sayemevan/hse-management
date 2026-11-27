CREATE TABLE `risk_matrix_version` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`size` integer NOT NULL,
	`likelihood` text NOT NULL,
	`consequence` text NOT NULL,
	`bands` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `risk_matrix_version_unique` ON `risk_matrix_version` (`company_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `safety_event` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`type_id` text NOT NULL,
	`family` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`reported_late` integer DEFAULT false NOT NULL,
	`area_id` text,
	`location_id` text,
	`work_zone_id` text,
	`latitude` real,
	`longitude` real,
	`location_accuracy_m` real,
	`reported_by` text NOT NULL,
	`reported_severity` text NOT NULL,
	`severity` text,
	`immediate_action` text,
	`potential_outcome` text,
	`damage_details` text,
	`environment_details` text,
	`risk_matrix_version` integer,
	`risk_likelihood` integer,
	`risk_consequence` integer,
	`risk_score` integer,
	`risk_band` text,
	`risk_band_label` text,
	`status` text NOT NULL,
	`investigation_required` integer DEFAULT false NOT NULL,
	`review_started_at` integer,
	`review_started_by` text,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_note` text,
	`self_reviewed` integer DEFAULT false NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_kind` text,
	`void_reason` text,
	`duplicate_of` text,
	`closed_at` integer,
	`closed_by` text,
	`closure_kind` text,
	`closure_summary` text,
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
	FOREIGN KEY (`type_id`) REFERENCES `safety_event_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`work_zone_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_event_number_unique` ON `safety_event` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `safety_event_project_status_idx` ON `safety_event` (`project_id`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `safety_event_reporter_idx` ON `safety_event` (`company_id`,`reported_by`,`status`);--> statement-breakpoint
CREATE INDEX `safety_event_type_idx` ON `safety_event` (`project_id`,`type_id`);--> statement-breakpoint
CREATE INDEX `safety_event_area_idx` ON `safety_event` (`area_id`);--> statement-breakpoint
CREATE INDEX `safety_event_location_idx` ON `safety_event` (`location_id`);--> statement-breakpoint
CREATE INDEX `safety_event_work_zone_idx` ON `safety_event` (`work_zone_id`);--> statement-breakpoint
CREATE TABLE `safety_event_category_link` (
	`event_id` text NOT NULL,
	`category_id` text NOT NULL,
	`company_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `safety_list_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_event_category_unique` ON `safety_event_category_link` (`event_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `safety_event_category_item_idx` ON `safety_event_category_link` (`category_id`);--> statement-breakpoint
CREATE TABLE `safety_event_cause` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`category_id` text,
	`description` text NOT NULL,
	`whys` text NOT NULL,
	`position` integer NOT NULL,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `safety_list_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_event_cause_event_idx` ON `safety_event_cause` (`event_id`,`kind`);--> statement-breakpoint
CREATE TABLE `safety_event_file` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_id` text NOT NULL,
	`file_id` text NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL,
	`witness_id` text,
	`captured_at` integer NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_event_file_event_idx` ON `safety_event_file` (`event_id`);--> statement-breakpoint
CREATE TABLE `safety_event_investigation` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`due_on` text NOT NULL,
	`instructions` text,
	`sequence_of_events` text,
	`lessons_learned` text,
	`assigned_at` integer NOT NULL,
	`assigned_by` text NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`completed_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_event_investigation_event_unique` ON `safety_event_investigation` (`event_id`);--> statement-breakpoint
CREATE TABLE `safety_event_investigation_member` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`investigation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer NOT NULL,
	`added_by` text NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	FOREIGN KEY (`investigation_id`) REFERENCES `safety_event_investigation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_event_member_idx` ON `safety_event_investigation_member` (`investigation_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `safety_event_person` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_id` text NOT NULL,
	`workforce_member_id` text,
	`user_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`injury_nature` text,
	`body_part` text,
	`treatment` text,
	`days_lost` integer,
	`detail` text,
	`removed_at` integer,
	`removed_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_event_person_event_idx` ON `safety_event_person` (`event_id`);--> statement-breakpoint
CREATE TABLE `safety_event_recommendation` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text NOT NULL,
	`event_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`no_action_reason` text,
	`addendum` integer DEFAULT false NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_event_recommendation_seq_unique` ON `safety_event_recommendation` (`event_id`,`seq`);--> statement-breakpoint
CREATE TABLE `safety_event_type` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name_en` text,
	`name_ar` text,
	`name_key_en` text,
	`name_key_ar` text,
	`family` text NOT NULL,
	`investigation` text NOT NULL,
	`min_severity` text,
	`injury_details` integer DEFAULT false NOT NULL,
	`area_required` integer DEFAULT false NOT NULL,
	`risk_rating` text NOT NULL,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`seed_key` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `safety_event_type_company_idx` ON `safety_event_type` (`company_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `safety_event_type_seed_unique` ON `safety_event_type` (`company_id`,`seed_key`);--> statement-breakpoint
CREATE TABLE `safety_event_witness` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_id` text NOT NULL,
	`workforce_member_id` text,
	`user_id` text,
	`name` text NOT NULL,
	`company` text,
	`contact` text,
	`statement` text,
	`statement_on` text,
	`taken_by` text,
	`removed_at` integer,
	`removed_by` text,
	`remove_reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`event_id`) REFERENCES `safety_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_event_witness_event_idx` ON `safety_event_witness` (`event_id`);--> statement-breakpoint
CREATE TABLE `safety_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`list` text NOT NULL,
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
CREATE INDEX `safety_list_item_company_idx` ON `safety_list_item` (`company_id`,`list`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `safety_list_item_seed_unique` ON `safety_list_item` (`company_id`,`list`,`seed_key`);