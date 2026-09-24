import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { inArray, isNull, asc, sql, eq, and, gt } from 'drizzle-orm';
import * as schema from './schema';
import { cotdDaysTable, playerRatingStateTable, type RatingMode, type SelectPlayerRatingState, type InsertCotdDay, type SelectCotdDay } from './schema.ts';

const client = createClient({
  url: process.env.DB_FILE_NAME!,
});
const db = drizzle(client, { schema });
const CHUNK_SIZE = 1;

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

export async function setQualifierChallengeId(cupId: number, challengeId: number) {
  await db.update(cotdDaysTable).set({ qualifierChallengeId: challengeId }).where(eq(cotdDaysTable.cupId, cupId));
}

export async function markCotdDayProcessed(cupId: number, cardinal: number) {
  await db.update(cotdDaysTable).set({ processedAt: new Date(), cardinal }).where(eq(cotdDaysTable.cupId, cupId));
}

export async function getStatesForAccounts(accountIds: string[]): Promise<Map<string, SelectPlayerRatingState>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db.select().from(playerRatingStateTable)
    .where(and(inArray(playerRatingStateTable.accountId, accountIds), eq(playerRatingStateTable.mode, 'qualifying')));
  return new Map(rows.map(r => [r.accountId, r]));
}

export async function batchUpsertRatingStates(
  updates: (Omit<SelectPlayerRatingState, 'updatedAt'>)[]
) {
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE).map(u => ({ ...u, updatedAt: new Date() }));
    await db.insert(playerRatingStateTable).values(chunk).onConflictDoUpdate({
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
}