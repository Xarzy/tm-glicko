import { sqliteTable, integer, text, real, primaryKey } from 'drizzle-orm/sqlite-core';

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
});

export type InsertPlayerRatingState = typeof playerRatingStateTable.$inferInsert;
export type SelectPlayerRatingState = typeof playerRatingStateTable.$inferSelect;
export type InsertCotdDay = typeof cotdDaysTable.$inferInsert;
export type SelectCotdDay = typeof cotdDaysTable.$inferSelect;