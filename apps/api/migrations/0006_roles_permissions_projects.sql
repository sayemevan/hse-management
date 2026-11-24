CREATE TABLE `company_role_permission` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`role_code` text NOT NULL,
	`permission_code` text NOT NULL,
	`granted` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permission_code`) REFERENCES `permission`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_role_permission_unique` ON `company_role_permission` (`company_id`,`role_code`,`permission_code`);--> statement-breakpoint
CREATE TABLE `permission` (
	`code` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`scope_level` text NOT NULL,
	`company_editable` integer NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_permission` (
	`role_code` text NOT NULL,
	`permission_code` text NOT NULL,
	PRIMARY KEY(`role_code`, `permission_code`),
	FOREIGN KEY (`permission_code`) REFERENCES `permission`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`client_name` text NOT NULL,
	`contract_number` text,
	`description` text,
	`city` text,
	`country_code` text NOT NULL,
	`start_date` text NOT NULL,
	`expected_end_date` text,
	`status` text NOT NULL,
	`status_before_hold` text,
	`status_before_archive` text,
	`status_changed_at` integer NOT NULL,
	`archived_at` integer,
	`archived_by` text,
	`created_at` integer NOT NULL,
	`created_by` text,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_company_code_unique` ON `project` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `project_company_status_idx` ON `project` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_company_name_idx` ON `project` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `user_role_project_idx` ON `user_role` (`project_id`);