CREATE TABLE `company_settings` (
	`company_id` text PRIMARY KEY NOT NULL,
	`date_format` text DEFAULT 'DD/MM/YYYY' NOT NULL,
	`time_format` text DEFAULT '24h' NOT NULL,
	`week_start` integer DEFAULT 0 NOT NULL,
	`working_days_mask` integer DEFAULT 31 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`invited_by` text NOT NULL,
	`role_code` text NOT NULL,
	`language` text NOT NULL,
	`sent_at` integer NOT NULL,
	`last_sent_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resend_count` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_invitation_user_idx` ON `user_invitation` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_invitation_company_idx` ON `user_invitation` (`company_id`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`category` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_storage_key_unique` ON `file` (`storage_key`);--> statement-breakpoint
CREATE INDEX `file_company_category_idx` ON `file` (`company_id`,`category`);--> statement-breakpoint
ALTER TABLE `company` ADD `registration_number` text;--> statement-breakpoint
ALTER TABLE `company` ADD `address` text;--> statement-breakpoint
ALTER TABLE `user` ADD `phone` text;--> statement-breakpoint
-- US-013: default settings for companies approved before Sprint 3 (D-37).
INSERT INTO `company_settings` (`company_id`, `created_at`, `updated_at`)
SELECT `id`, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM `company`;
