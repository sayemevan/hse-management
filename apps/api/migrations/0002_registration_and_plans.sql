CREATE TABLE `company_registration` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`company_name` text NOT NULL,
	`slug` text NOT NULL,
	`country_code` text NOT NULL,
	`city` text NOT NULL,
	`time_zone` text NOT NULL,
	`default_language` text NOT NULL,
	`applicant_name` text NOT NULL,
	`applicant_email` text NOT NULL,
	`applicant_phone` text NOT NULL,
	`applicant_language` text NOT NULL,
	`password_hash` text NOT NULL,
	`plan_code` text NOT NULL,
	`terms_accepted_at` integer NOT NULL,
	`email_verified_at` integer,
	`submitted_at` integer,
	`decided_at` integer,
	`company_id` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`plan_code`) REFERENCES `plan`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_registration_open_slug_unique` ON `company_registration` (`slug`) WHERE status NOT IN ('approved', 'closed');--> statement-breakpoint
CREATE UNIQUE INDEX `company_registration_open_email_unique` ON `company_registration` (`applicant_email`) WHERE status NOT IN ('approved', 'closed');--> statement-breakpoint
CREATE INDEX `company_registration_status_idx` ON `company_registration` (`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `registration_review` (
	`id` text PRIMARY KEY NOT NULL,
	`registration_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`phone_confirmed` integer NOT NULL,
	`previous_plan_code` text,
	`new_plan_code` text,
	`decided_by` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`registration_id`) REFERENCES `company_registration`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `registration_review_registration_idx` ON `registration_review` (`registration_id`);--> statement-breakpoint
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name_en` text NOT NULL,
	`name_ar` text NOT NULL,
	`max_projects` integer,
	`max_users` integer,
	`max_storage_bytes` integer NOT NULL,
	`monthly_price_halalas` integer,
	`annual_price_halalas` integer,
	`sort_order` integer NOT NULL,
	`is_active` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_code_unique` ON `plan` (`code`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`trial_started_at` integer,
	`trial_ends_at` integer,
	`current_period_end` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_company_unique` ON `subscription` (`company_id`);--> statement-breakpoint
CREATE INDEX `subscription_status_idx` ON `subscription` (`status`);--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`recipient` text NOT NULL,
	`language` text NOT NULL,
	`data` text NOT NULL,
	`has_secrets` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`last_error` text,
	`company_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `email_outbox_status_created_idx` ON `email_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `one_time_token` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`subject_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_time_token_hash_unique` ON `one_time_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `one_time_token_subject_idx` ON `one_time_token` (`purpose`,`subject_id`);--> statement-breakpoint
ALTER TABLE `company` ADD `country_code` text;--> statement-breakpoint
ALTER TABLE `company` ADD `city` text;--> statement-breakpoint
ALTER TABLE `company` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `company` ADD `contact_phone` text;