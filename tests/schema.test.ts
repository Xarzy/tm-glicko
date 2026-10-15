// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import {
  challengeLeaderboardsTable,
  cotdDaysTable,
  playerRatingHistoryTable,
  playerRatingStateTable,
} from '../src/db/schema';

test('rating state schema defines its composite primary key and rating index', () => {
  const config = getTableConfig(playerRatingStateTable);

  expect(config.name).toBe('player_rating_state');
  expect(config.columns.map(column => column.name)).toContain('match_count');
  expect(config.primaryKeys).toHaveLength(1);
  expect(config.indexes.map(index => index.config.name)).toContain('idx_player_rating_mode_rating');
});

test('COTD day schema defines date and leaderboard indexes', () => {
  const config = getTableConfig(cotdDaysTable);

  expect(config.name).toBe('cotd_days');
  expect(config.columns.map(column => column.name)).toContain('processed_at');
  expect(config.columns.find(column => column.name === 'cotd_date')?.isUnique).toBe(true);
  expect(config.columns.find(column => column.name === 'cup_id')?.primary).toBe(true);
  expect(config.indexes).toHaveLength(3);
});

test('challenge leaderboard schema defines player and challenge indexes', () => {
  const config = getTableConfig(challengeLeaderboardsTable);

  expect(config.name).toBe('challenge_leaderboards');
  expect(config.primaryKeys).toHaveLength(1);
  expect(config.indexes.map(index => index.config.name)).toEqual([
    'idx_challenge_leaderboards_player',
    'idx_challenge_leaderboards_challenge_id',
  ]);
});

test('rating history schema defines account/date and cup indexes', () => {
  const config = getTableConfig(playerRatingHistoryTable);

  expect(config.name).toBe('player_rating_history');
  expect(config.columns.map(column => column.name)).toContain('is_flagged');
  expect(config.columns.find(column => column.name === 'id')?.primary).toBe(true);
  expect(config.indexes).toHaveLength(2);
});
