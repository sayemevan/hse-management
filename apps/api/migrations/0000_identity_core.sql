CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`default_language` text NOT NULL,
	`time_zone` text NOT NULL,
	`logo_file_id` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_slug_unique` ON `company` (`slug`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text NOT NULL,
	`preferred_language` text,
	`time_zone` text,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`password_changed_at` integer,
	`workforce_member_id` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `user_company_idx` ON `user` (`company_id`);--> statement-breakpoint
CREATE TABLE `user_role` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_code` text NOT NULL,
	`scope_level` text NOT NULL,
	`company_id` text,
	`project_id` text,
	`valid_from` integer,
	`valid_until` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_role_user_idx` ON `user_role` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text,
	`previous_refresh_token_hash` text,
	`refresh_rotated_at` integer,
	`device_label` text NOT NULL,
	`browser` text NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_session_user_idx` ON `user_session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_session_refresh_unique` ON `user_session` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `user_session_previous_refresh_idx` ON `user_session` (`previous_refresh_token_hash`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_user_id` text,
	`company_id` text,
	`project_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`outcome` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`request_id` text,
	`ip_address` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_occurred_at_idx` ON `audit_log` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_log_company_occurred_idx` ON `audit_log` (`company_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);