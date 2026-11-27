CREATE TABLE `idempotency_key` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_key_company_key_idx` ON `idempotency_key` (`company_id`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_key_expires_idx` ON `idempotency_key` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sync_conflict` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`project_id` text,
	`user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`label` text NOT NULL,
	`project_code` text,
	`base_version` integer NOT NULL,
	`server_version` integer NOT NULL,
	`changed_by` text,
	`client_payload` text NOT NULL,
	`server_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`resolution` text,
	`resolved_values` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `sync_conflict_user_idx` ON `sync_conflict` (`company_id`,`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sync_conflict_entity_idx` ON `sync_conflict` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `sync_conflict_open_idx` ON `sync_conflict` (`status`,`created_at`);