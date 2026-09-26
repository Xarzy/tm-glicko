import { db } from '../src/db';
import { cotdDaysTable, playerRatingStateTable, playerRatingHistoryTable } from '../src/db/schema';
import {
  getStatesForAccounts,
  batchUpsertRatingStates,
  getChallengeLeaderboard,
  markCotdDayProcessed,
  batchInsertRatingHistory,
  runRaw,
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
  const nowMs = () => Date.now();
  const runStartMs = nowMs();
  let indexRebuildMs = 0;

  console.log('[recalculate] Resetting qualifying player ratings and history...');

  // Performance: temporarily drop heavy indexes on the write-hot table.
  // This drastically reduces insert cost as the history table grows.
  // (We recreate the indexes implicitly by relying on schema migrations
  //  at runtime; if your environment doesn't auto-recreate, tell me and
  //  I'll add explicit CREATE INDEX statements.)
  console.log('[recalculate] Dropping history indexes for faster inserts...');
  runRaw('PRAGMA foreign_keys = OFF;');
  runRaw('DROP INDEX IF EXISTS idx_rating_history_account_mode_date;');
  runRaw('DROP INDEX IF EXISTS idx_rating_history_cup_id;');

  console.log('[recalculate] Dropping rating state indexes for faster rebuild...');
  runRaw('DROP INDEX IF EXISTS idx_player_rating_mode_rating;');

  await db.delete(playerRatingStateTable).where(eq(playerRatingStateTable.mode, 'qualifying'));
  await db.delete(playerRatingHistoryTable).where(eq(playerRatingHistoryTable.mode, 'qualifying'));

  // Recreate indexes after recalculation.
  // Note: drizzle doesn't automatically recreate dropped indexes at runtime.
  // These statements should match the index names created in schema.ts.
  const recreateIndexes = async () => {
    const indexStartMs = nowMs();
    console.log('[recalculate] Recreating history indexes...');
    await runRaw('CREATE INDEX IF NOT EXISTS idx_rating_history_account_mode_date ON player_rating_history (account_id, mode, cotd_date);');
    await runRaw('CREATE INDEX IF NOT EXISTS idx_rating_history_cup_id ON player_rating_history (cup_id);');

    console.log('[recalculate] Recreating rating state indexes...');
    await runRaw('CREATE INDEX IF NOT EXISTS idx_player_rating_mode_rating ON player_rating_state (mode, rating);');
    indexRebuildMs += nowMs() - indexStartMs;
  };

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

  const FLUSH_EVERY_CUPS = 1000;
  let processedCount = 0;
  let pendingHistory: any[] = [];
  let pendingStateUpdates: any[] = [];

  let totalUpsertMs = 0;
  let totalHistoryMs = 0;
  let totalMarkMs = 0;
  let totalStateRowsWritten = 0;
  let totalHistoryRowsWritten = 0;
  let flushCounter = 0;
  const FLUSH_LOG_EVERY = 1; // flush blocks

  const flushPending = async () => {
    if (pendingStateUpdates.length === 0 && pendingHistory.length === 0) return;

    const stateUpdates = pendingStateUpdates;
    const historyEntries = pendingHistory;
    pendingStateUpdates = [];
    pendingHistory = [];

    // Dedupe state updates: within a flush block, the same player often
    // appears multiple times across cups. Upserting the latest only
    // drastically reduces ON CONFLICT work.
    let uniqueStateUpdates: typeof stateUpdates = stateUpdates;
    if (stateUpdates.length > 0) {
      const latestByAccount = new Map<string, any>();
      for (const u of stateUpdates) {
        latestByAccount.set(u.accountId, u);
      }
      uniqueStateUpdates = Array.from(latestByAccount.values());
    }

    // Always log sizes for performance tuning.
    if (pendingHistory.length > 0 || stateUpdates.length > 0) {
      console.log(
        `[recalculate] flushPending sizes | state: ${stateUpdates.length} -> ${uniqueStateUpdates.length} unique | historyRows: ${historyEntries.length}`
      );
    }

    // Performance strategy for SQLite:
    // Avoid nested transactions: `batchInsertRatingHistory` already uses
    // its own transaction internally.

    if (uniqueStateUpdates.length > 0) {
      const t0 = nowMs();
      const accountIds = uniqueStateUpdates.map((u: any) => u.accountId);
      const escapedIds = accountIds.map(id => `'${String(id).replace(/'/g, "''")}'`);

      // Delete affected keys for qualifying mode.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idList = escapedIds.join(',');
      runRaw(
        `DELETE FROM player_rating_state WHERE mode = 'qualifying' AND account_id IN (${idList});`
      );

      // Insert fresh states.
      const now = new Date();
      const rows = uniqueStateUpdates.map((u: any) => ({ ...u, updatedAt: now }));
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        await db.insert(playerRatingStateTable).values(chunk);
      }

      totalUpsertMs += nowMs() - t0;
      totalStateRowsWritten += uniqueStateUpdates.length;
    }

    if (historyEntries.length > 0) {
      const t0 = nowMs();
      await batchInsertRatingHistory(historyEntries);
      totalHistoryMs += nowMs() - t0;
      totalHistoryRowsWritten += historyEntries.length;
    }
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
    const tMark0 = nowMs();
    await markCotdDayProcessed(day.cupId, cardinal);
    totalMarkMs += nowMs() - tMark0;
    processedCount++;
    console.log(
      `[recalculate] (${processedCount}) Processed cup ${day.cupId} (${day.name}) with ${allResults.length} players`
    );

    if (processedCount % FLUSH_EVERY_CUPS === 0) {
      // flatten pendingHistory (we pushed arrays)
      pendingHistory = pendingHistory.flat();
      await flushPending();
      flushCounter++;

      if (flushCounter % FLUSH_LOG_EVERY === 0) {
        const elapsed = nowMs() - runStartMs;
        console.log(
          `[recalculate] flush#${flushCounter} after ${processedCount} cups | elapsed=${(elapsed / 1000).toFixed(1)}s | upsert=${(totalUpsertMs / 1000).toFixed(1)}s | history=${(totalHistoryMs / 1000).toFixed(1)}s | mark=${(totalMarkMs / 1000).toFixed(1)}s`
        );
      }
    }
  }

  // final flush
  pendingHistory = pendingHistory.flat();
  await flushPending();

  try {
    if (stopRequested) {
      console.log(`[recalculate] Exited cleanly. Processed ${processedCount} cups before stopping.`);
    } else {
      console.log(`[recalculate] Finished! Successfully recalculated ratings across ${processedCount} cups.`);
    }
  } finally {
    await recreateIndexes();
    const elapsedMs = nowMs() - runStartMs;
    const elapsedSeconds = elapsedMs / 1000;
    const timedMs = totalUpsertMs + totalHistoryMs + totalMarkMs;
    const averageCupSeconds = processedCount > 0 ? elapsedSeconds / processedCount : 0;

    console.log('[recalculate] Run metrics:');
    console.log(`  wall time: ${elapsedSeconds.toFixed(1)}s`);
    console.log(`  cups processed: ${processedCount} / ${cups.length}`);
    console.log(`  average throughput: ${processedCount > 0 ? (processedCount / elapsedSeconds).toFixed(2) : '0.00'} cups/s (${averageCupSeconds.toFixed(2)}s/cup)`);
    console.log(`  state rows written: ${totalStateRowsWritten}`);
    console.log(`  history rows written: ${totalHistoryRowsWritten}`);
    console.log(`  state writes: ${(totalUpsertMs / 1000).toFixed(1)}s`);
    console.log(`  history writes: ${(totalHistoryMs / 1000).toFixed(1)}s`);
    console.log(`  processed markers: ${(totalMarkMs / 1000).toFixed(1)}s`);
    console.log(`  index rebuild: ${(indexRebuildMs / 1000).toFixed(1)}s`);
    console.log(`  compute/setup/other: ${Math.max(0, (elapsedMs - timedMs - indexRebuildMs) / 1000).toFixed(1)}s`);
  }
}

main();
