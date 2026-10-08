CREATE TABLE `challenge_leaderboards` (
	`challenge_id` integer NOT NULL,
	`player` text NOT NULL,
	`rank` integer NOT NULL,
	`score` integer,
	PRIMARY KEY(`challenge_id`, `player`)
);
--> statement-breakpoint
CREATE INDEX `idx_challenge_leaderboards_player` ON `challenge_leaderboards` (`player`);--> statement-breakpoint
CREATE INDEX `idx_challenge_leaderboards_challenge_id` ON `challenge_leaderboards` (`challenge_id`);--> statement-breakpoint
CREATE TABLE `cotd_days` (
	`cup_id` integer PRIMARY KEY NOT NULL,
	`cotd_date` text NOT NULL,
	`competition_id` integer NOT NULL,
	`name` text NOT NULL,
	`start_date` integer NOT NULL,
	`qualifier_challenge_id` integer,
	`cardinal` integer,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cotd_days_cotd_date_unique` ON `cotd_days` (`cotd_date`);--> statement-breakpoint
CREATE INDEX `idx_cotd_days_qualifier_challenge_id` ON `cotd_days` (`qualifier_challenge_id`);--> statement-breakpoint
CREATE INDEX `idx_cotd_days_start_date` ON `cotd_days` (`start_date`);--> statement-breakpoint
CREATE INDEX `idx_cotd_days_processed_at` ON `cotd_days` (`processed_at`);--> statement-breakpoint
CREATE TABLE `player_rating_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`cup_id` integer NOT NULL,
	`cotd_date` text NOT NULL,
	`mode` text NOT NULL,
	`rating` real NOT NULL,
	`rd` real NOT NULL,
	`rank` integer,
	`is_flagged` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rating_history_account_mode_date` ON `player_rating_history` (`account_id`,`mode`,`cotd_date`);--> statement-breakpoint
CREATE INDEX `idx_rating_history_cup_id` ON `player_rating_history` (`cup_id`);--> statement-breakpoint
CREATE TABLE `player_rating_state` (
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`rating` real DEFAULT 1500 NOT NULL,
	`rd` real DEFAULT 350 NOT NULL,
	`vol` real DEFAULT 0.06 NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`peak_rating` real DEFAULT 1500 NOT NULL,
	`previous_rating` real,
	`last_processed_cup_id` integer,
	`last_rated_at` integer,
	`last_fetched_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `mode`)
);
--> statement-breakpoint
CREATE INDEX `idx_player_rating_mode_rating` ON `player_rating_state` (`mode`,`rating`);