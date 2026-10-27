// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { InsertCotdDay, InsertPlayerRatingHistory, SelectPlayerRatingState } from '../src/db/schema';

const originalDbFileName = process.env.DB_FILE_NAME;
const originalLibsqlUrl = process.env.LIBSQL_URL;
const originalLibsqlAuthToken = process.env.LIBSQL_AUTH_TOKEN;
const originalLibsqlToken = process.env.LIBSQL_TOKEN;
process.env.DB_FILE_NAME = ':memory:?cache=shared';
delete process.env.LIBSQL_URL;
delete process.env.LIBSQL_AUTH_TOKEN;
delete process.env.LIBSQL_TOKEN;

mock.module('../src/db/retry', () => ({
  retryDatabaseCall: (_operationName: string, operation: () => Promise<unknown>) => operation(),
}));

const database = await import('../src/db');
const schema = await import('../src/db/schema');
const migrationPath = fileURLToPath(new URL('../drizzle/0000_initial-libsql-schema.sql', import.meta.url));
const migrationStatements = readFileSync(migrationPath, 'utf8')
  .split('--> statement-breakpoint')
  .filter(statement => statement.trim());

beforeAll(async () => {
  for (const statement of migrationStatements) {
    await database.db.run(sql.raw(makeIdempotent(statement)));
  }
});

beforeEach(async () => {
  await database.db.delete(schema.playerRatingHistoryTable);
  await database.db.delete(schema.challengeLeaderboardsTable);
  await database.db.delete(schema.playerRatingStateTable);
  await database.db.delete(schema.cotdDaysTable);
});

afterAll(async () => {
  await database.db.$client.close();
  if (originalDbFileName === undefined) delete process.env.DB_FILE_NAME;
  else process.env.DB_FILE_NAME = originalDbFileName;
  if (originalLibsqlUrl === undefined) delete process.env.LIBSQL_URL;
  else process.env.LIBSQL_URL = originalLibsqlUrl;
  if (originalLibsqlAuthToken === undefined) delete process.env.LIBSQL_AUTH_TOKEN;
  else process.env.LIBSQL_AUTH_TOKEN = originalLibsqlAuthToken;
  if (originalLibsqlToken === undefined) delete process.env.LIBSQL_TOKEN;
  else process.env.LIBSQL_TOKEN = originalLibsqlToken;
});

function createState(
  accountId: string,
  overrides: Partial<Omit<SelectPlayerRatingState, 'accountId' | 'updatedAt'>> = {},
): Omit<SelectPlayerRatingState, 'accountId' | 'updatedAt'> {
  return {
    mode: 'qualifying',
    rating: 1_500,
    rd: 100,
    vol: 0.06,
    matchCount: 10,
    peakRating: 1_500,
    previousRating: null,
    lastProcessedCupId: 20261001,
    lastRatedAt: new Date('2026-10-01T00:00:00Z'),
    lastFetchedAt: null,
    ...overrides,
  };
}

function createCup(cupId: number, overrides: Partial<InsertCotdDay> = {}): InsertCotdDay {
  return {
    cupId,
    cotdDate: `2026-10-${String(cupId % 100).padStart(2, '0')}`,
    competitionId: cupId,
    name: `COTD ${cupId}`,
    startDate: new Date(`2026-10-${String(cupId % 100).padStart(2, '0')}T16:00:00Z`),
    qualifierChallengeId: null,
    cardinal: null,
    processedAt: null,
    ...overrides,
  };
}

function makeIdempotent(statement: string): string {
  return statement
    .replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
    .replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ');
}

test('rating helpers create defaults, upsert state, and calculate eligible leaderboard positions', async () => {
  expect(database.leaderboardScore(1_700, 100)).toBe(1_650);
  const missing = await database.getPlayerRatingState('missing', 'qualifying');
  expect(missing.rating).toBe(1_500);
  expect(await database.getPlayerRatingStateIfExists('missing', 'qualifying')).toBeUndefined();

  await database.upsertPlayerRatingState('first', 'qualifying', createState('first', { rating: 2_000 }));
  await database.upsertPlayerRatingState('second', 'qualifying', createState('second', { rating: 2_000 }));
  await database.upsertPlayerRatingState('third', 'qualifying', createState('third', { rating: 1_000 }));
  await database.upsertPlayerRatingState('unranked', 'qualifying', createState('unranked', {
    rating: 3_000,
    matchCount: 9,
  }));
  await database.upsertPlayerRatingState('cup-mode', 'cup', createState('cup-mode', {
    mode: 'cup',
    rating: 4_000,
  }));

  expect((await database.getPlayerRatingState('first', 'qualifying')).rating).toBe(2_000);
  expect((await database.getPlayerRatingStateIfExists('first', 'qualifying'))?.rating).toBe(2_000);
  expect(await database.getEligibleRatingPlayerCount()).toBe(3);
  expect(await database.getEligibleRatingPlayerCount('cup')).toBe(1);
  expect(await database.getRatingRank('qualifying', 'first', 2_000)).toEqual({ rank: 1, total: 3 });
  expect(await database.getRatingRank('qualifying', 'second', 2_000)).toEqual({ rank: 2, total: 3 });
  expect(await database.getRatingRank('qualifying', 'external', 1_500)).toEqual({ rank: 3, total: 3 });

  expect((await database.getPlayerRatingStateByRank('qualifying', 2))?.state.accountId).toBe('second');
  expect((await database.getPlayerRatingStateByRank('qualifying', 2))?.total).toBe(3);
  expect(await database.getPlayerRatingStateByRank('qualifying', 0)).toBeNull();
  expect(await database.getPlayerRatingStateByRank('qualifying', 4)).toBeNull();

  const page = await database.getPlayerRatingStatesByRankRange('qualifying', 2, 2);
  expect(page.states.map(state => state.accountId)).toEqual(['second', 'third']);
  expect(page.total).toBe(3);
  expect(await database.getPlayerRatingStatesByRankRange('qualifying', 4, 2)).toEqual({
    states: [],
    total: 0,
  });
  await expect(database.getPlayerRatingStatesByRankRange('qualifying', 0, 1)).rejects.toThrow('positive integer');
  await expect(database.getPlayerRatingStatesByRankRange('qualifying', 1, 0)).rejects.toThrow('positive integer');
});

test('COTD storage lists pending, processed, and leaderboard-incomplete cups', async () => {
  await database.insertCotdDaysIfNew([]);
  await database.insertCotdDaysIfNew([
    createCup(20261001, { qualifierChallengeId: 1001 }),
    createCup(20261002, { qualifierChallengeId: 1002, cardinal: 500, processedAt: new Date() }),
    createCup(20261003, { qualifierChallengeId: 1003, cardinal: 0, processedAt: new Date() }),
    createCup(20261004),
  ]);
  await database.insertCotdDaysIfNew([createCup(20261001)]);
  await database.saveChallengeLeaderboard(1002, [{ player: 'done', rank: 1, score: 1_000 }]);

  expect(await database.cotdDateExists('2026-10-01')).toBe(true);
  expect(await database.cotdDateExists('missing')).toBe(false);
  expect((await database.getCotdDayById(20261001))?.name).toBe('COTD 20261001');
  expect(await database.getCotdDayById(1)).toBeUndefined();
  expect((await database.getPendingCotdDays(10)).map(day => day.cupId)).toEqual([
    20261001, 20261004,
  ]);
  expect((await database.getRecentProcessedCotdDays()).map(day => day.cupId)).toEqual([
    20261002,
  ]);
  expect((await database.getCupsNeedingLeaderboards()).map(day => day.cupId)).toEqual([
    20261001, 20261003, 20261004,
  ]);
  await expect(database.getRecentProcessedCotdDays(0)).rejects.toThrow('between 1 and 100');
  await expect(database.getRecentProcessedCotdDays(101)).rejects.toThrow('between 1 and 100');

  await database.setQualifierChallengeId(20261004, 1004);
  await database.markCotdDayProcessed(20261004, 400);
  const processed = await database.getCotdDayById(20261004);
  expect(processed?.qualifierChallengeId).toBe(1004);
  expect(processed?.cardinal).toBe(400);
  expect(processed?.processedAt).toBeInstanceOf(Date);

  await database.saveChallengeLeaderboard(1001, [
    { player: 'second', rank: 2, score: 900 },
    { player: 'first', rank: 1, score: 1_000 },
  ]);
  expect(await database.getCotdResults(20261001, 1)).toEqual([
    { player: 'first', rank: 1, score: 1_000 },
  ]);
  expect(await database.getCotdResults(20261003)).toEqual([]);
  expect(await database.getCotdResults(999999)).toEqual([]);
  await expect(database.getCotdResults(20261001, 0)).rejects.toThrow('between 1 and 100');
  await expect(database.getCotdResults(20261001, 101)).rejects.toThrow('between 1 and 100');
});

test('challenge leaderboards are saved transactionally and read in rank order', async () => {
  await database.saveChallengeLeaderboard(42, []);
  await database.saveChallengeLeaderboard(42, [
    { player: 'second', rank: 2, score: 900 },
    { player: 'first', rank: 1, score: 1_000 },
    { player: 'third', rank: 3 },
  ]);
  expect(await database.getChallengeLeaderboard(42)).toEqual([
    { player: 'first', rank: 1, score: 1_000 },
    { player: 'second', rank: 2, score: 900 },
    { player: 'third', rank: 3, score: null },
  ]);

  await database.saveChallengeLeaderboard(42, [{ player: 'second', rank: 4, score: null }]);
  expect(await database.getChallengeLeaderboard(42)).toContainEqual({
    player: 'second',
    rank: 4,
    score: null,
  });
});

test('rating histories filter ineligible rows and calculate peaks and changes', async () => {
  await database.insertCotdDaysIfNew(Array.from({ length: 12 }, (_, index) => {
    const day = index + 1;
    return createCup(20261000 + day, {
      qualifierChallengeId: 9000 + day,
      cardinal: 1_000,
      processedAt: new Date(),
      cotdDate: `2026-10-${String(day).padStart(2, '0')}`,
    });
  }));
  await database.upsertPlayerRatingState('history-player', 'qualifying', createState('history-player'));
  await database.upsertPlayerRatingState('short-history', 'qualifying', createState('short-history', {
    matchCount: 9,
  }));

  const history: InsertPlayerRatingHistory[] = Array.from({ length: 12 }, (_, index) => ({
    accountId: 'history-player',
    cupId: 20261001 + index,
    cotdDate: `2026-10-${String(index + 1).padStart(2, '0')}`,
    mode: 'qualifying',
    rating: 1_500 + index * 10,
    rd: 100,
    rank: index + 1,
    isFlagged: index === 10,
  }));
  history.push({
    ...history[0]!,
    accountId: 'short-history',
    cupId: 20261001,
    cotdDate: '2026-10-01',
  });
  await database.batchInsertRatingHistory([]);
  await database.batchInsertRatingHistory(history);

  expect(await database.getEligiblePeakRating('history-player', 'qualifying')).toBe(1_610);
  expect(await database.getEligiblePeakRating('short-history', 'qualifying')).toBeNull();
  expect(await database.getRatingHistoryForAccounts([], 'qualifying')).toEqual([]);
  const accountHistory = await database.getRatingHistoryForAccounts([
    'history-player',
    'history-player',
    'short-history',
  ]);
  expect(accountHistory).toHaveLength(11);
  expect(accountHistory[0]?.cotdDate).toBe('2026-10-01');
  expect(accountHistory.at(-1)?.cotdDate).toBe('2026-10-12');
  expect(await database.getRatingHistoryForAccounts(['history-player'], 'cup')).toEqual([]);

  const recent = await database.getRecentEligibleRatingHistory('history-player');
  expect(recent).toHaveLength(2);
  expect(recent[0]).toEqual({
    cupId: 20261010,
    cotdDate: '2026-10-10',
    name: 'COTD 20261010',
    cardinal: 1_000,
    rank: 10,
    rating: 1_590,
    ratingChange: 10,
  });
  expect(recent[1]?.ratingChange).toBe(20);
  expect(await database.getRecentEligibleRatingHistory('short-history')).toEqual([]);
  await expect(database.getRecentEligibleRatingHistory('history-player', 0)).rejects.toThrow('between 1 and 500');
  await expect(database.getRecentEligibleRatingHistory('history-player', 501)).rejects.toThrow('between 1 and 500');

  await database.upsertPlayerRatingState('paged-history', 'qualifying', createState('paged-history'));
  const pagedEntries: InsertPlayerRatingHistory[] = Array.from({ length: 1_001 }, (_, index) => ({
    accountId: 'paged-history',
    cupId: index + 1,
    cotdDate: '2026-10-01',
    mode: 'qualifying',
    rating: 1_500 + index,
    rd: 100,
    rank: index + 1,
    isFlagged: false,
  }));
  await database.batchInsertRatingHistory(pagedEntries);
  expect(await database.getRatingHistoryForAccounts(['paged-history'])).toHaveLength(1_001);
});

test('division samples use processed cups and omit flagged or missing placements', async () => {
  expect(await database.getRecentCotdDivisionSamples()).toEqual([]);
  await database.insertCotdDaysIfNew([
    createCup(1, { cardinal: 1_000, processedAt: new Date() }),
    createCup(2, { cardinal: 500, processedAt: new Date() }),
    createCup(3, { cardinal: 1_000 }),
    createCup(4, { cardinal: 0, processedAt: new Date() }),
  ]);
  await database.batchInsertRatingHistory([
    { accountId: 'p1', cupId: 1, cotdDate: '2026-10-01', mode: 'qualifying', rating: 1_600, rd: 100, rank: 50, isFlagged: false },
    { accountId: 'p2', cupId: 1, cotdDate: '2026-10-01', mode: 'qualifying', rating: 1_700, rd: 100, rank: 60, isFlagged: true },
    { accountId: 'p3', cupId: 1, cotdDate: '2026-10-01', mode: 'cup', rating: 1_800, rd: 100, rank: 70, isFlagged: false },
    { accountId: 'p4', cupId: 2, cotdDate: '2026-10-02', mode: 'qualifying', rating: 1_900, rd: 100, rank: null, isFlagged: false },
  ]);

  expect(await database.getRecentCotdDivisionSamples()).toEqual([
    { rating: 1_600, rank: 50, fieldSize: 1_000 },
  ]);
  expect(await database.getRecentCotdDivisionSamples(2)).toEqual([
    { rating: 1_600, rank: 50, fieldSize: 1_000 },
  ]);
  await expect(database.getRecentCotdDivisionSamples(0)).rejects.toThrow('positive integer');
});

test('bulk rating updates and account state lookup deduplicate and chunk IDs', async () => {
  await database.batchUpsertRatingStates([]);
  const accounts = Array.from({ length: 1_001 }, (_, index) => `player-${index}`);
  const updates = accounts.map((accountId, index) =>
    createState(accountId, { rating: 3_000 - index })
  ).map((state, index) => ({
    accountId: accounts[index]!,
    ...state,
  }));
  const log = mock(() => {});
  const originalLog = console.log;
  console.log = log;
  try {
    await database.batchUpsertRatingStates(updates);
  } finally {
    console.log = originalLog;
  }

  const states = await database.getStatesForAccounts([
    ...accounts,
    accounts[0]!,
  ]);
  expect(states.size).toBe(1_001);
  expect(states.get('player-1000')?.rating).toBe(2_000);
  expect(await database.getStatesForAccounts([])).toEqual(new Map());

  await database.batchUpsertRatingStates([{
    accountId: accounts[0]!,
    ...createState(accounts[0]!, { rating: 4_000 }),
  }]);
  expect((await database.getPlayerRatingState(accounts[0]!, 'qualifying')).rating).toBe(4_000);

  const warning = mock(() => {});
  const originalWarn = console.warn;
  console.warn = warning;
  try {
    await database.batchReplaceRatingStates([{
      accountId: accounts[1]!,
      ...createState(accounts[1]!, { rating: 4_001 }),
    }]);
  } finally {
    console.warn = originalWarn;
  }
  expect(warning).toHaveBeenCalledTimes(1);
  expect((await database.getPlayerRatingState(accounts[1]!, 'qualifying')).rating).toBe(4_001);
});

test('rating state helpers return documented fallbacks when their table is unavailable', async () => {
  await database.db.run(sql.raw('DROP TABLE player_rating_state'));
  const errors = mock(() => {});
  const originalError = console.error;
  console.error = errors;
  try {
    expect((await database.getPlayerRatingState('missing', 'qualifying')).rating).toBe(1_500);
    expect(await database.upsertPlayerRatingState(
      'broken',
      'qualifying',
      createState('broken'),
    )).toBeUndefined();
    expect(await database.getRatingRank('qualifying', 'broken', 1_500)).toEqual({
      rank: 0,
      total: 0,
    });
    expect(await database.getPlayerRatingStateByRank('qualifying', 1)).toBeNull();
    expect(errors).toHaveBeenCalledTimes(4);
  } finally {
    console.error = originalError;
    for (const statement of migrationStatements.filter(statement =>
      statement.includes('player_rating_state')
    )) {
      await database.db.run(sql.raw(makeIdempotent(statement)));
    }
  }
});
