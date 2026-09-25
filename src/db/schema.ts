import { sqliteTable, integer, text, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const ratingModeValues = ['qualifying', 'cup'] as const;
export type RatingMode = typeof ratingModeValues[number];

export const playerRatingStateTable = sqliteTable('player_rating_state', {
  accountId: text('account_id').notNull(),
  mode: text('mode', { enum: ratingModeValues }).notNull(),
  rating: real('rating').notNull().default(1500),
  rd: real('rd').notNull().default(350),
  vol: real('vol').notNull().default(0.06),
  matchCount: integer('match_count').notNull().default(0),
  peakRating: real('peak_rating').notNull().default(1500),
  previousRating: real('previous_rating'),
  lastProcessedCupId: integer('last_processed_cup_id'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.accountId, table.mode] }),
  ratingIdx: index('idx_player_rating_mode_rating').on(table.mode, table.rating),
}));

export const cotdDaysTable = sqliteTable('cotd_days', {
  cupId: integer('cup_id').primaryKey(),
  cotdDate: text('cotd_date').notNull().unique(),
  competitionId: integer('competition_id').notNull(),
  name: text('name').notNull(),
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  qualifierChallengeId: integer('qualifier_challenge_id'),
  cardinal: integer('cardinal'),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
}, (table) => ({
  qualifierChallengeIdIdx: index('idx_cotd_days_qualifier_challenge_id').on(table.qualifierChallengeId),
  startDateIdx: index('idx_cotd_days_start_date').on(table.startDate),
  processedAtIdx: index('idx_cotd_days_processed_at').on(table.processedAt),
}));

export const challengeLeaderboardsTable = sqliteTable('challenge_leaderboards', {
  challengeId: integer('challenge_id').notNull(),
  player: text('player').notNull(),
  rank: integer('rank').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.challengeId, table.player] }),
  playerIdx: index('idx_challenge_leaderboards_player').on(table.player),
  challengeIdIdx: index('idx_challenge_leaderboards_challenge_id').on(table.challengeId),
}));

export const playerRatingHistoryTable = sqliteTable('player_rating_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: text('account_id').notNull(),
  cupId: integer('cup_id').notNull(),
  cotdDate: text('cotd_date').notNull(),
  mode: text('mode', { enum: ratingModeValues }).notNull(),
  rating: real('rating').notNull(),
  rd: real('rd').notNull(),
  rank: integer('rank'),
}, (table) => ({
  accountModeDateIdx: index('idx_rating_history_account_mode_date').on(table.accountId, table.mode, table.cotdDate),
  cupIdx: index('idx_rating_history_cup_id').on(table.cupId),
}));

export type InsertPlayerRatingState = typeof playerRatingStateTable.$inferInsert;
export type SelectPlayerRatingState = typeof playerRatingStateTable.$inferSelect;
export type InsertCotdDay = typeof cotdDaysTable.$inferInsert;
export type SelectCotdDay = typeof cotdDaysTable.$inferSelect;
export type InsertChallengeLeaderboard = typeof challengeLeaderboardsTable.$inferInsert;
export type SelectChallengeLeaderboard = typeof challengeLeaderboardsTable.$inferSelect;
export type InsertPlayerRatingHistory = typeof playerRatingHistoryTable.$inferInsert;
export type SelectPlayerRatingHistory = typeof playerRatingHistoryTable.$inferSelect;