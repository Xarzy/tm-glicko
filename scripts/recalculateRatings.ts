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

  let processedCount = 0;
  for (const day of cups) {
    if (stopRequested) break;
    if (!day.qualifierChallengeId) continue;

    // Load purely from local DB
    const allResults = await getChallengeLeaderboard(day.qualifierChallengeId);
    if (allResults.length === 0) {
      continue; // Skip cups whose leaderboards haven't been fetched yet
    }

    const cardinal = day.cardinal && day.cardinal > 0 ? day.cardinal : allResults.length;
    const existingStates = await getStatesForAccounts(allResults.map(r => r.player));

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

    await batchUpsertRatingStates(updates);
    await batchInsertRatingHistory(
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
    await markCotdDayProcessed(day.cupId, cardinal);
    processedCount++;
    console.log(
      `[recalculate] (${processedCount}) Processed cup ${day.cupId} (${day.name}) with ${allResults.length} players`
    );
  }

  if (stopRequested) {
    console.log(`[recalculate] Exited cleanly. Processed ${processedCount} cups before stopping.`);
  } else {
    console.log(`[recalculate] Finished! Successfully recalculated ratings across ${processedCount} cups.`);
  }
}

main();
