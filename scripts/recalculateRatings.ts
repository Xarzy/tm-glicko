import { db } from '../src/db';
import { cotdDaysTable, playerRatingStateTable, playerRatingHistoryTable } from '../src/db/schema';
import {
  getStatesForAccounts,
  batchUpsertRatingStates,
  getChallengeLeaderboard,
  markCotdDayProcessed,
  batchInsertRatingHistory,
} from '../src/db';
import { applyQualifyingCupResult } from '../src/services/glickoService';
import { asc, eq, sql } from 'drizzle-orm';

const DEFAULT_STATE = {
  rating: 1500,
  rd: 350,
  vol: 0.06,
  matchCount: 0,
  peakRating: 1500,
  previousRating: null,
  lastProcessedCupId: null,
};

let stopRequested = false;
process.on('SIGINT', () => {
  if (stopRequested) {
    console.log('\n[recalculate] Force exiting...');
    process.exit(1);
  }
  console.log('\n[recalculate] Stop requested — finishing current cup, then exiting...');
  stopRequested = true;
});

async function main() {
  console.log('[recalculate] Resetting qualifying player ratings and history...');
  await db.delete(playerRatingStateTable).where(eq(playerRatingStateTable.mode, 'qualifying'));
  await db.delete(playerRatingHistoryTable).where(eq(playerRatingHistoryTable.mode, 'qualifying'));

  console.log('[recalculate] Querying cups with downloaded leaderboards...');
  const cups = await db
    .select()
    .from(cotdDaysTable)
    .where(
      sql`${cotdDaysTable.qualifierChallengeId} IN (
        SELECT DISTINCT challenge_id FROM challenge_leaderboards
      )`
    )
    .orderBy(asc(cotdDaysTable.startDate));

  console.log(`[recalculate] Found ${cups.length} cups with saved leaderboards to recalculate.`);

  const tTotalStart = Date.now();
  const tPhase = (label: string, fn: () => Promise<void>) => fn().then(() => {
    console.log(`[recalculate] ${label} took ${Math.round((Date.now()) / 1)}`);
  });

  // Preload all leaderboards for the cup list so we can compute updates without
  // doing DB reads per cup (fixes performance worsening over time).
  console.log('[recalculate] Preloading leaderboards for all cups...');
  const leaderboardByChallengeId = new Map<number, { player: string; rank: number }[]>();
  const allChallengeIds: number[] = [];
  for (const day of cups) {
    if (day.qualifierChallengeId && day.qualifierChallengeId > 0) {
      allChallengeIds.push(day.qualifierChallengeId);
    }
  }
  const uniqueChallengeIds = Array.from(new Set(allChallengeIds));
  for (const challengeId of uniqueChallengeIds) {
    const rows = await getChallengeLeaderboard(challengeId);
    leaderboardByChallengeId.set(challengeId, rows);
  }

  // Preload states once for all players appearing in any preloaded leaderboard.
  console.log('[recalculate] Preloading rating states for all involved players...');
  const allPlayersSet = new Set<string>();
  for (const rows of leaderboardByChallengeId.values()) {
    for (const r of rows) allPlayersSet.add(r.player);
  }
  const allPlayers = Array.from(allPlayersSet);
  const existingStates = await getStatesForAccounts(allPlayers);

  const FLUSH_EVERY_CUPS = 20;
  let processedCount = 0;
  let pendingHistory: any[] = [];
  let pendingStateUpdates: any[] = [];

  const flushPending = async () => {
    if (pendingStateUpdates.length === 0 && pendingHistory.length === 0) return;

    const stateUpdates = pendingStateUpdates;
    const historyEntries = pendingHistory;
    pendingStateUpdates = [];
    pendingHistory = [];

    await db.transaction(async (tx) => {
      // batch upserts
      if (stateUpdates.length > 0) {
        // reuse existing batching helper but write via the main db object
        // (helper uses db.transaction internally). To keep this safe, we call it directly.
        await batchUpsertRatingStates(stateUpdates);
      }
      if (historyEntries.length > 0) {
        await batchInsertRatingHistory(historyEntries);
      }
    });
  };

  for (const day of cups) {
    if (stopRequested) break;
    if (!day.qualifierChallengeId) continue;

    const allResults = leaderboardByChallengeId.get(day.qualifierChallengeId) ?? [];
    if (allResults.length === 0) {
      continue; // Skip cups whose leaderboards haven't been fetched yet
    }

    const cardinal = day.cardinal && day.cardinal > 0 ? day.cardinal : allResults.length;

    const participants = allResults.map(entry => {
      const s = existingStates.get(entry.player) ?? {
        accountId: entry.player,
        mode: 'qualifying' as const,
        ...DEFAULT_STATE,
      };
      return {
        player: entry.player,
        rank: entry.rank,
        rating: s.rating,
        rd: s.rd,
      };
    });

    const updates = allResults.map(entry => {
      const state = existingStates.get(entry.player) ?? {
        accountId: entry.player,
        mode: 'qualifying' as const,
        ...DEFAULT_STATE,
      };
      const updated = applyQualifyingCupResult(state, entry.rank, participants);

      return {
        accountId: entry.player,
        mode: 'qualifying' as const,
        rating: updated.rating,
        rd: updated.rd,
        vol: updated.vol,
        matchCount: state.matchCount + 1,
        peakRating: Math.max(state.peakRating, updated.rating),
        previousRating: state.rating,
        lastProcessedCupId: day.cupId,
        lastFetchedAt: new Date(),
      };
    });

    // Update in-memory states so subsequent cups use the freshest ratings without extra DB reads
    for (const u of updates) {
      const prev = existingStates.get(u.accountId) ?? {
        accountId: u.accountId,
        mode: 'qualifying' as const,
        ...DEFAULT_STATE,
      };
      existingStates.set(u.accountId, {
        ...prev,
        rating: u.rating,
        rd: u.rd,
        vol: u.vol,
        matchCount: u.matchCount,
        peakRating: u.peakRating,
        previousRating: u.previousRating,
        lastProcessedCupId: u.lastProcessedCupId,
        lastFetchedAt: u.lastFetchedAt,
        updatedAt: new Date(),
      });
    }

    pendingStateUpdates.push(...updates);
    pendingHistory.push(
      updates.map((u, i) => ({
        accountId: u.accountId,
        cupId: day.cupId,
        cotdDate: day.cotdDate,
        mode: 'qualifying' as const,
        rating: u.rating,
        rd: u.rd,
        rank: allResults[i]?.rank ?? null,
      }))
    );

    // Keep processed marker writes outside the heavy flush cycle for correctness.
    await markCotdDayProcessed(day.cupId, cardinal);
    processedCount++;
    console.log(
      `[recalculate] (${processedCount}) Processed cup ${day.cupId} (${day.name}) with ${allResults.length} players`
    );

    if (processedCount % FLUSH_EVERY_CUPS === 0) {
      // flatten pendingHistory (we pushed arrays)
      pendingHistory = pendingHistory.flat();
      await flushPending();
    }
  }

  // final flush
  pendingHistory = pendingHistory.flat();
  await flushPending();

  if (stopRequested) {
    console.log(`[recalculate] Exited cleanly. Processed ${processedCount} cups before stopping.`);
  } else {
    console.log(`[recalculate] Finished! Successfully recalculated ratings across ${processedCount} cups.`);
  }
}

main();
