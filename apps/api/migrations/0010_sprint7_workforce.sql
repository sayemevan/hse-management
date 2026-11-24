CREATE TABLE `workforce_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`workforce_member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`job_position_id` text,
	`start_date` text NOT NULL,
	`end_date` text,
	`note` text,
	`ended_by` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`workforce_member_id`) REFERENCES `workforce_member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_position_id`) REFERENCES `workforce_list_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workforce_assignment_project_idx` ON `workforce_assignment` (`project_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `workforce_assignment_member_idx` ON `workforce_assignment` (`workforce_member_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `workforce_assignment_end_idx` ON `workforce_assignment` (`company_id`,`end_date`);--> statement-breakpoint
CREATE TABLE `workforce_emergency_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`workforce_member_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`relationship` text NOT NULL,
	`phone` text NOT NULL,
	`phone_alt` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`workforce_member_id`) REFERENCES `workforce_member`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workforce_contact_member_idx` ON `workforce_emergency_contact` (`workforce_member_id`,`position`);--> statement-breakpoint
CREATE TABLE `workforce_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`list` text NOT NULL,
	`seed_key` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workforce_list_item_name_unique` ON `workforce_list_item` (`company_id`,`list`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workforce_list_item_seed_unique` ON `workforce_list_item` (`company_id`,`list`,`seed_key`);--> statement-breakpoint
CREATE INDEX `workforce_list_item_order_idx` ON `workforce_list_item` (`company_id`,`list`,`active`,`position`);--> statement-breakpoint
CREATE TABLE `workforce_member` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`category` text NOT NULL,
	`full_name` text NOT NULL,
	`alt_name` text,
	`employee_id` text,
	`employee_id_key` text,
	`nationality` text NOT NULL,
	`employer` text NOT NULL,
	`job_position_id` text NOT NULL,
	`department` text,
	`mobile` text,
	`email` text,
	`photo_file_id` text,
	`status` text NOT NULL,
	`status_since` text NOT NULL,
	`status_reason` text,
	`search_key` text NOT NULL,
	`archived_at` integer,
	`archived_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`job_position_id`) REFERENCES `workforce_list_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workforce_member_employee_id_unique` ON `workforce_member` (`company_id`,`employee_id_key`);--> statement-breakpoint
CREATE INDEX `workforce_member_status_idx` ON `workforce_member` (`company_id`,`archived_at`,`status`);--> statement-breakpoint
CREATE INDEX `workforce_member_category_idx` ON `workforce_member` (`company_id`,`category`);--> statement-breakpoint
CREATE INDEX `workforce_member_position_idx` ON `workforce_member` (`company_id`,`job_position_id`);--> statement-breakpoint
CREATE INDEX `workforce_member_nationality_idx` ON `workforce_member` (`company_id`,`nationality`);--> statement-breakpoint
CREATE INDEX `workforce_member_name_idx` ON `workforce_member` (`company_id`,`full_name`);--> statement-breakpoint
CREATE TABLE `workforce_record` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`workforce_member_id` text NOT NULL,
	`kind` text NOT NULL,
	`type` text,
	`name` text,
	`competency_id` text,
	`number` text,
	`number_key` text,
	`issuer` text,
	`country` text,
	`issued_on` text,
	`expires_on` text,
	`no_expiry` integer DEFAULT false NOT NULL,
	`reference` text,
	`restriction_note` text,
	`note` text,
	`file_id` text,
	`replaces_id` text,
	`replaced_at` integer,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`workforce_member_id`) REFERENCES `workforce_member`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`competency_id`) REFERENCES `workforce_list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replaces_id`) REFERENCES `workforce_record`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workforce_record_member_idx` ON `workforce_record` (`workforce_member_id`,`kind`,`voided_at`);--> statement-breakpoint
CREATE INDEX `workforce_record_expiry_idx` ON `workforce_record` (`company_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `workforce_record_number_idx` ON `workforce_record` (`company_id`,`kind`,`type`,`country`,`number_key`);--> statement-breakpoint
CREATE INDEX `workforce_record_competency_idx` ON `workforce_record` (`company_id`,`competency_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_workforce_member_unique` ON `user` (`workforce_member_id`);