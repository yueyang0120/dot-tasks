CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
