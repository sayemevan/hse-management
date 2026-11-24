CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`billing_cycle` text NOT NULL,
	`amount_halalas` integer NOT NULL,
	`transferred_on` text NOT NULL,
	`reference` text,
	`file_id` text NOT NULL,
	`status` text NOT NULL,
	`submitted_by` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`rejection_reason` text,
	`confirmed_plan_id` text,
	`confirmed_billing_cycle` text,
	`confirmed_amount_halalas` integer,
	`period_start` integer,
	`period_end` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscription`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_company_status_idx` ON `payment` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_status_submitted_idx` ON `payment` (`status`,`submitted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_one_pending_per_company` ON `payment` (`company_id`) WHERE "payment"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`processed` integer NOT NULL,
	`changed` integer NOT NULL,
	`failed` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `job_run_name_started_idx` ON `job_run` (`job_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`company_id` text,
	`template` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_log_key_unique` ON `reminder_log` (`key`);--> statement-breakpoint
CREATE INDEX `reminder_log_company_idx` ON `reminder_log` (`company_id`);--> statement-breakpoint
ALTER TABLE `subscription` ADD `billing_cycle` text;--> statement-breakpoint
ALTER TABLE `subscription` ADD `current_period_start` integer;--> statement-breakpoint
ALTER TABLE `subscription` ADD `grace_ends_at` integer;--> statement-breakpoint
ALTER TABLE `subscription` ADD `read_only_since` integer;--> statement-breakpoint
ALTER TABLE `subscription` ADD `pending_plan_id` text REFERENCES plan(id);--> statement-breakpoint
CREATE INDEX `subscription_status_period_idx` ON `subscription` (`status`,`current_period_end`);--> statement-breakpoint
CREATE INDEX `subscription_status_trial_idx` ON `subscription` (`status`,`trial_ends_at`);