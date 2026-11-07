CREATE TABLE `player_display_names` (
	`account_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_player_display_names_normalized_name` ON `player_display_names` (`normalized_name`);