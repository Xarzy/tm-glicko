import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { inArray, isNotNull, isNull, asc, sql, eq, and, gt } from 'drizzle-orm';
import * as schema from './schema';
import {
  cotdDaysTable,
  playerRatingStateTable,
  challengeLeaderboardsTable,
  playerRatingHistoryTable,
  type RatingMode,
  type SelectPlayerRatingState,
  type InsertCotdDay,
  type SelectCotdDay,
  type InsertChallengeLeaderboard,
  type InsertPlayerRatingHistory,
} from './schema.ts';

const dbPath = (process.env.DB_FILE_NAME || 'local.db').replace(/^file:/, '');
const sqlite = new Database(dbPath);
// Enable WAL mode for better concurrency and performance
sqlite.exec('PRAGMA journal_mode = WAL;');

export const db = drizzle(sqlite, { schema });
const CHUNK_SIZE = 500;

const DEFAULT_STATE: Omit<SelectPlayerRatingState, 'accountId' | 'mode' | 'updatedAt'> = {
  rating: 1500,
  rd: 350,
  vol: 0.06,
  matchCount: 0,
  peakRating: 1500,
  previousRating: null,
  lastProcessedCupId: null,
  lastFetchedAt: null,
};

export async function getPlayerRatingState(
  accountId: string,
  mode: RatingMode
): Promise<SelectPlayerRatingState> {
  try {
    const result = await db.query.playerRatingStateTable.findFirst({
      where: and(eq(playerRatingStateTable.accountId, accountId), eq(playerRatingStateTable.mode, mode)),
    });
    if (result) return result;
    return { accountId, mode, ...DEFAULT_STATE, updatedAt: new Date() };
  } catch (error) {
    console.error(error);
    return { accountId, mode, ...DEFAULT_STATE, updatedAt: new Date() };
  }
}

export async function upsertPlayerRatingState(
  accountId: string,
  mode: RatingMode,
  state: Omit<SelectPlayerRatingState, 'accountId' | 'mode' | 'updatedAt'>
): Promise<SelectPlayerRatingState | undefined> {
  try {
    const result = await db.insert(playerRatingStateTable)
      .values({ accountId, mode, ...state, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [playerRatingStateTable.accountId, playerRatingStateTable.mode],
        set: { ...state, updatedAt: new Date() },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

export async function getRatingRank(
  mode: RatingMode,
  rating: number
): Promise<{ rank: number; total: number }> {
  try {
    const [aheadResult, totalResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(playerRatingStateTable)
        .where(and(eq(playerRatingStateTable.mode, mode), gt(playerRatingStateTable.rating, rating))),
      db.select({ count: sql<number>`count(*)` })
        .from(playerRatingStateTable)
        .where(eq(playerRatingStateTable.mode, mode)),
    ]);

    return {
      rank: (aheadResult[0]?.count ?? 0) + 1,
      total: totalResult[0]?.count ?? 0,
    };
  } catch (error) {
    console.error(error);
    return { rank: 0, total: 0 };
  }
}

export async function getPlayerRatingStateByRank(
  mode: RatingMode,
  rank: number
): Promise<{ state: SelectPlayerRatingState; total: number } | null> {
  try {
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(playerRatingStateTable)
      .where(and(eq(playerRatingStateTable.mode, mode), isNotNull(playerRatingStateTable.lastProcessedCupId)));

    const total = totalResult[0]?.count ?? 0;
    if (rank < 1 || rank > total) return null;

    const row = await db.query.playerRatingStateTable.findFirst({
      where: and(eq(playerRatingStateTable.mode, mode), isNotNull(playerRatingStateTable.lastProcessedCupId)),
      orderBy: [sql`${playerRatingStateTable.rating} DESC`],
      offset: rank - 1,
    });

    if (!row) return null;
    return { state: row, total };
  } catch (error) {
    console.error('[getPlayerRatingStateByRank] error:', error);
    return null;
  }
}

export async function insertCotdDaysIfNew(days: InsertCotdDay[]) {
  if (days.length === 0) return;
  await db.insert(cotdDaysTable).values(days).onConflictDoNothing();
}

export async function getPendingCotdDays(limit: number): Promise<SelectCotdDay[]> {
  return db.select().from(cotdDaysTable)
    .where(isNull(cotdDaysTable.processedAt))
    .orderBy(asc(cotdDaysTable.startDate))
    .limit(limit);
}

export async function getCupsNeedingLeaderboards(): Promise<SelectCotdDay[]> {
  return db
    .select()
    .from(cotdDaysTable)
    .where(
      sql`${cotdDaysTable.qualifierChallengeId} IS NULL OR NOT EXISTS (
        SELECT 1 FROM ${challengeLeaderboardsTable}
        WHERE ${challengeLeaderboardsTable.challengeId} = ${cotdDaysTable.qualifierChallengeId}
      )`
    )
    .orderBy(asc(cotdDaysTable.startDate));
}

export async function getCotdDayById(cupId: number): Promise<SelectCotdDay | undefined> {
  return db.query.cotdDaysTable.findFirst({
    where: eq(cotdDaysTable.cupId, cupId),
  });
}

export async function setQualifierChallengeId(cupId: number, challengeId: number) {
  await db.update(cotdDaysTable).set({ qualifierChallengeId: challengeId }).where(eq(cotdDaysTable.cupId, cupId));
}

export async function markCotdDayProcessed(cupId: number, cardinal: number) {
  await db.update(cotdDaysTable).set({ processedAt: new Date(), cardinal }).where(eq(cotdDaysTable.cupId, cupId));
}

export async function getStatesForAccounts(accountIds: string[]): Promise<Map<string, SelectPlayerRatingState>> {
  if (accountIds.length === 0) return new Map();
  const map = new Map<string, SelectPlayerRatingState>();
  for (let i = 0; i < accountIds.length; i += CHUNK_SIZE) {
    const chunk = accountIds.slice(i, i + CHUNK_SIZE);
    const rows = await db.select().from(playerRatingStateTable)
      .where(and(inArray(playerRatingStateTable.accountId, chunk), eq(playerRatingStateTable.mode, 'qualifying')));
    for (const r of rows) {
      map.set(r.accountId, r);
    }
  }
  return map;
}

export async function cotdDateExists(cotdDate: string): Promise<boolean> {
  const row = await db.query.cotdDaysTable.findFirst({ where: eq(cotdDaysTable.cotdDate, cotdDate) });
  return !!row;
}

export async function batchUpsertRatingStates(
  updates: (Omit<SelectPlayerRatingState, 'updatedAt'>)[]
) {
  if (updates.length === 0) return;
  const now = new Date();
  console.log("batching " + updates.length + " states to the database - batchUpsertRatingStates");
  await db.transaction(async (tx) => {
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE).map(u => ({ ...u, updatedAt: now }));
      await tx.insert(playerRatingStateTable).values(chunk).onConflictDoUpdate({
        target: [playerRatingStateTable.accountId, playerRatingStateTable.mode],
        set: {
          rating: sql`excluded.rating`,
          rd: sql`excluded.rd`,
          vol: sql`excluded.vol`,
          matchCount: sql`excluded.match_count`,
          peakRating: sql`excluded.peak_rating`,
          previousRating: sql`excluded.previous_rating`,
          lastProcessedCupId: sql`excluded.last_processed_cup_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }
  });
}

export async function getChallengeLeaderboard(challengeId: number): Promise<{ player: string; rank: number }[]> {
  const rows = await db.select({
    player: challengeLeaderboardsTable.player,
    rank: challengeLeaderboardsTable.rank,
  })
    .from(challengeLeaderboardsTable)
    .where(eq(challengeLeaderboardsTable.challengeId, challengeId))
    .orderBy(asc(challengeLeaderboardsTable.rank));

  return rows;
}

export async function saveChallengeLeaderboard(
  challengeId: number,
  results: { player: string; rank: number }[]
) {
  if (results.length === 0) return;
  const rows: InsertChallengeLeaderboard[] = results.map(r => ({
    challengeId,
    player: r.player,
    rank: r.rank,
  }));

    await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await tx.insert(challengeLeaderboardsTable).values(chunk).onConflictDoNothing();
    }
  });
}

export async function batchInsertRatingHistory(entries: InsertPlayerRatingHistory[]) {
  if (entries.length === 0) return;
  await db.transaction(async (tx) => {
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      await tx.insert(playerRatingHistoryTable).values(chunk);
    }
  });
}

export async function getRatingHistoryForAccounts(
  accountIds: string[],
  mode: RatingMode = 'qualifying'
): Promise<{ accountId: string; cotdDate: string; rating: number; cupId: number }[]> {
  if (accountIds.length === 0) return [];
  return db
    .select({
      accountId: playerRatingHistoryTable.accountId,
      cotdDate: playerRatingHistoryTable.cotdDate,
      rating: playerRatingHistoryTable.rating,
      cupId: playerRatingHistoryTable.cupId,
    })
    .from(playerRatingHistoryTable)
    .where(
      and(
        inArray(playerRatingHistoryTable.accountId, accountIds),
        eq(playerRatingHistoryTable.mode, mode)
      )
    )
    .orderBy(asc(playerRatingHistoryTable.cotdDate));
}
