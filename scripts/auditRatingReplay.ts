import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db, getChallengeLeaderboard } from '../src/db';
import {
  cotdDaysTable,
  playerRatingHistoryTable,
  type SelectPlayerRatingState,
} from '../src/db/schema';
import {
  applyQualifyingCupResult,
  getRatingSeedRanks,
  isLikelyAbandonedQualifyingRun,
  prepareQualifyingState,
  QUALIFYING_RATING_CONFIG,
} from '../src/services/glickoService';

const TARGET_ACCOUNTS = [
  ['GranaDy.', '05477e79-25fd-48c2-84c7-e1621aa46517'],
  ['L1ngo...', 'b981e0b1-2d6a-4470-9b52-c1f6b0b1d0a6'],
  ['Scrapie98', 'da4642f9-6acf-43fe-88b6-b120ff1308ba'],
  ['Ivancicus', 'c35a454d-2c1a-4e5c-a031-b4361e7dbe10'],
  ['Nauu', 'bb4af693-5190-44c5-8448-d4ec36d95400'],
  ['xRubiixx', '50513aca-7225-46e9-8fad-231a69e5dc81'],
] as const;

const DEFAULT_STATE = {
  rating: QUALIFYING_RATING_CONFIG.initialRating,
  rd: QUALIFYING_RATING_CONFIG.initialRd,
  vol: QUALIFYING_RATING_CONFIG.initialVolatility,
  matchCount: 0,
  peakRating: QUALIFYING_RATING_CONFIG.initialRating,
  previousRating: null,
  lastProcessedCupId: null,
  lastRatedAt: null,
  lastFetchedAt: null,
};

type ReplayState = SelectPlayerRatingState;
type AuditRow = {
  accountId: string;
  cupId: number;
  cotdDate: string;
  rating: number;
  rd: number;
  rank: number | null;
  isFlagged: boolean;
};

function sameNumber(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 1e-9;
}

function stateFor(accountId: string, states: Map<string, ReplayState>): ReplayState {
  return states.get(accountId) ?? {
    accountId,
    mode: 'qualifying',
    ...DEFAULT_STATE,
    updatedAt: new Date(0),
  };
}

async function main() {
  const targetIds = TARGET_ACCOUNTS.map(([, accountId]) => accountId);
  const cups = await db
    .select()
    .from(cotdDaysTable)
    .where(sql`${cotdDaysTable.qualifierChallengeId} IN (
      SELECT DISTINCT challenge_id FROM challenge_leaderboards
    )`)
    .orderBy(asc(cotdDaysTable.startDate));

  const storedRows = await db
    .select({
      accountId: playerRatingHistoryTable.accountId,
      cupId: playerRatingHistoryTable.cupId,
      cotdDate: playerRatingHistoryTable.cotdDate,
      rating: playerRatingHistoryTable.rating,
      rd: playerRatingHistoryTable.rd,
      rank: playerRatingHistoryTable.rank,
      isFlagged: playerRatingHistoryTable.isFlagged,
    })
    .from(playerRatingHistoryTable)
    .where(sql`${playerRatingHistoryTable.mode} = 'qualifying' AND ${inArray(playerRatingHistoryTable.accountId, targetIds)}`);

  const storedByKey = new Map(storedRows.map(row => [`${row.accountId}:${row.cupId}`, row]));
  const states = new Map<string, ReplayState>();
  const firstMismatch = new Map<string, { cupId: number; date: string; expected: AuditRow; actual: typeof storedRows[number] | undefined }>();
  const replayRows = new Map<string, AuditRow>();

  for (const cup of cups) {
    if (!cup.qualifierChallengeId) continue;
    const results = await getChallengeLeaderboard(cup.qualifierChallengeId);
    if (results.length === 0) continue;

    const ratedAt = new Date(cup.startDate);
    const preparedStates = results.map(entry => {
      const state = stateFor(entry.player, states);
      return prepareQualifyingState(state, state.lastRatedAt, ratedAt);
    });
    const seedRanks = getRatingSeedRanks(preparedStates.map(state => state.rating));
    const ratedResults = results
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => !isLikelyAbandonedQualifyingRun({
        rating: preparedStates[index].rating,
        matchCount: stateFor(entry.player, states).matchCount,
        rank: entry.rank,
        ratingSeedRank: seedRanks[index],
        fieldSize: results.length,
      }));
    const participants = ratedResults.map(({ entry, index }) => ({
      player: entry.player,
      rank: entry.rank,
      rating: preparedStates[index].rating,
      rd: preparedStates[index].rd,
    }));
    const updates = ratedResults.map(({ entry }, playerIndex) => {
      const state = stateFor(entry.player, states);
      const prepared = prepareQualifyingState(state, state.lastRatedAt, ratedAt);
      const updated = applyQualifyingCupResult(prepared, entry.player, entry.rank, participants, playerIndex);
      const next: ReplayState = {
        ...state,
        rating: updated.rating,
        rd: updated.rd,
        vol: updated.vol,
        matchCount: state.matchCount + 1,
        peakRating: Math.max(state.peakRating, updated.rating),
        previousRating: state.rating,
        lastProcessedCupId: cup.cupId,
        lastRatedAt: ratedAt,
        updatedAt: new Date(),
      };
      states.set(entry.player, next);
      return [entry.player, next] as const;
    });
    const updatesByAccount = new Map(updates);

    for (const entry of results) {
      const current = updatesByAccount.get(entry.player) ?? stateFor(entry.player, states);
      const row: AuditRow = {
        accountId: entry.player,
        cupId: cup.cupId,
        cotdDate: cup.cotdDate,
        rating: current.rating,
        rd: current.rd,
        rank: entry.rank,
        isFlagged: !updatesByAccount.has(entry.player),
      };
      if (!targetIds.includes(entry.player as typeof targetIds[number])) continue;
      replayRows.set(`${entry.player}:${cup.cupId}`, row);
      const stored = storedByKey.get(`${entry.player}:${cup.cupId}`);
      const matches = stored
        && stored.cotdDate === row.cotdDate
        && sameNumber(stored.rating, row.rating)
        && sameNumber(stored.rd, row.rd)
        && stored.rank === row.rank
        && stored.isFlagged === row.isFlagged;
      if (!matches && !firstMismatch.has(entry.player)) {
        firstMismatch.set(entry.player, { cupId: cup.cupId, date: cup.cotdDate, expected: row, actual: stored });
      }
    }
  }

  console.log(`Audited ${cups.length} cups and ${replayRows.size} target history rows.`);
  for (const [name, accountId] of TARGET_ACCOUNTS) {
    const expectedRows = Array.from(replayRows.values()).filter(row => row.accountId === accountId).length;
    const actualRows = storedRows.filter(row => row.accountId === accountId).length;
    const mismatch = firstMismatch.get(accountId);
    console.log(JSON.stringify({
      name,
      accountId,
      replayRows: expectedRows,
      storedRows: actualRows,
      firstMismatch: mismatch ?? null,
    }));
  }
}

await main();
