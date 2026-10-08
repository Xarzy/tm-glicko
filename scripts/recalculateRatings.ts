import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/db';
import { cotdDaysTable, playerRatingStateTable, playerRatingHistoryTable } from '../src/db/schema';
import {
  getStatesForAccounts,
  getChallengeLeaderboard,
  markCotdDayProcessed,
} from '../src/db';
import {
  applyQualifyingCupResult,
  getRatingSeedRanks,
  isLikelyAbandonedQualifyingRun,
  prepareQualifyingState,
  QUALIFYING_RATING_CONFIG,
} from '../src/services/glickoService';
import { invalidateRankThresholdCache } from '../src/services/rankService';
import { asc, eq, sql } from 'drizzle-orm';

const PROGRESS_FILE = resolve('.rating-recalculation-progress.json');
const DEFAULT_STATE = {
  rating: QUALIFYING_RATING_CONFIG.initialRating,
  rd: QUALIFYING_RATING_CONFIG.initialRd,
  vol: QUALIFYING_RATING_CONFIG.initialVolatility,
  matchCount: 0,
  peakRating: QUALIFYING_RATING_CONFIG.initialRating,
  previousRating: null,
  lastProcessedCupId: null,
  lastRatedAt: null,
};

interface RecalculationProgress {
  lastCupId: number | null;
}

function saveProgress(progress: RecalculationProgress): void {
  const temporaryPath = `${PROGRESS_FILE}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(progress));
  renameSync(temporaryPath, PROGRESS_FILE);
}

function readProgress(): RecalculationProgress {
  if (!existsSync(PROGRESS_FILE)) {
    throw new Error('No recalculation checkpoint found. Start a new run without --resume.');
  }
  const progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) as RecalculationProgress;
  if (
    !progress
    || (progress.lastCupId !== null
      && (!Number.isSafeInteger(progress.lastCupId) || progress.lastCupId < 0))
  ) {
    throw new Error(`Invalid recalculation checkpoint in ${PROGRESS_FILE}.`);
  }
  return progress;
}

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
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => arg !== '--resume') || args.size !== process.argv.length - 2) {
    throw new Error('Usage: bun run scripts/recalculateRatings.ts [--resume]');
  }
  const resume = args.has('--resume');
  if (!resume && existsSync(PROGRESS_FILE)) {
    throw new Error(`A recalculation checkpoint already exists at ${PROGRESS_FILE}. Use --resume.`);
  }
  let progress = resume ? readProgress() : { lastCupId: null };
  if (!resume) saveProgress(progress);

  const nowMs = () => Date.now();
  const runStartMs = nowMs();

  if (resume) {
    console.log(`[recalculate] Resuming after cup ${progress.lastCupId ?? '(start)'}.`);
  } else {
    console.log('[recalculate] Resetting qualifying player ratings and history...');
    await db.delete(playerRatingStateTable).where(eq(playerRatingStateTable.mode, 'qualifying'));
    await db.delete(playerRatingHistoryTable).where(eq(playerRatingHistoryTable.mode, 'qualifying'));
  }

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
  let startCupIndex = 0;
  if (progress.lastCupId !== null) {
    const checkpointIndex = cups.findIndex(day => day.cupId === progress.lastCupId);
    if (checkpointIndex < 0) {
      throw new Error(
        `Checkpoint cup ${progress.lastCupId} is not in the current leaderboard history. `
        + `Do not delete ${PROGRESS_FILE}; inspect the database before continuing.`,
      );
    }
    startCupIndex = checkpointIndex + 1;
  }

  // Keep only chronological player state in memory. Leaderboards are loaded
  // one cup at a time and unseen players are fetched lazily.
  console.log('[recalculate] Using bounded leaderboard/state loading...');
  const existingStates = new Map<string, any>();

  // Flush regularly so a restart only needs to replay a small number of cups.
  const FLUSH_EVERY_CUPS = 75;
  let processedCount = 0;
  let pendingHistory: any[] = [];
  let pendingStateUpdates: any[] = [];
  let lastVisitedCupId = progress.lastCupId;

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
    const pendingStateCount = stateUpdates.length;
    const pendingHistoryCount = historyEntries.length;
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
    if (pendingHistoryCount > 0 || pendingStateCount > 0) {
      console.log(
        `[recalculate] flushPending sizes | state: ${pendingStateCount} -> ${uniqueStateUpdates.length} unique | historyRows: ${pendingHistoryCount}`
      );
    }

    let upsertDuration = 0;
    let historyDuration = 0;
    await db.transaction(async tx => {
      let t0 = nowMs();
      for (let i = 0; i < uniqueStateUpdates.length; i += 1000) {
        const updatedAt = new Date();
        const chunk = uniqueStateUpdates
          .slice(i, i + 1000)
          .map(update => ({ ...update, updatedAt }));
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
            lastRatedAt: sql`excluded.last_rated_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      }
      upsertDuration = nowMs() - t0;
      t0 = nowMs();
      for (let i = 0; i < historyEntries.length; i += 1000) {
        await tx.insert(playerRatingHistoryTable).values(historyEntries.slice(i, i + 1000));
      }
      historyDuration = nowMs() - t0;
    });
    totalUpsertMs += upsertDuration;
    totalHistoryMs += historyDuration;
    totalStateRowsWritten += uniqueStateUpdates.length;
    totalHistoryRowsWritten += historyEntries.length;
    if (lastVisitedCupId !== null) {
      progress = { lastCupId: lastVisitedCupId };
      saveProgress(progress);
    }
  };

  const totalCupsToProcess = cups.length - startCupIndex;
  for (let cupIdx = startCupIndex; cupIdx < cups.length; cupIdx++) {
    const day = cups[cupIdx];
    if (stopRequested) break;
    if (!day.qualifierChallengeId) {
      lastVisitedCupId = day.cupId;
      continue;
    }

    const allResults = await getChallengeLeaderboard(day.qualifierChallengeId);
    if (allResults.length === 0) {
      lastVisitedCupId = day.cupId;
      continue; // Skip cups whose leaderboards haven't been fetched yet
    }

    const missingPlayers = allResults
      .map(entry => entry.player)
      .filter(player => !existingStates.has(player));
    if (missingPlayers.length > 0) {
      const storedStates = await getStatesForAccounts(missingPlayers);
      for (const [accountId, state] of storedStates) {
        existingStates.set(accountId, state);
      }
    }

    const cardinal = day.cardinal && day.cardinal > 0 ? day.cardinal : allResults.length;
    const ratedAt = new Date(day.startDate);

    const preparedStates = allResults.map(entry => {
      const s = existingStates.get(entry.player) ?? {
        accountId: entry.player,
        mode: 'qualifying' as const,
        ...DEFAULT_STATE,
      };
      return prepareQualifyingState(s, s.lastRatedAt, ratedAt);
    });
    const ratingSeedRanks = getRatingSeedRanks(preparedStates.map(state => state.rating));
    const ratedResults = allResults.map((entry, index) => ({ entry, index })).filter(({ entry, index }) => {
      const state = existingStates.get(entry.player) ?? { ...DEFAULT_STATE };
      return !isLikelyAbandonedQualifyingRun({
        rating: preparedStates[index].rating,
        matchCount: state.matchCount,
        rank: entry.rank,
        ratingSeedRank: ratingSeedRanks[index],
        fieldSize: allResults.length,
      });
    });

    const participants = ratedResults.map(({ entry, index }) => {
      const prepared = preparedStates[index];
      return {
        player: entry.player,
        rank: entry.rank,
        rating: prepared.rating,
        rd: prepared.rd,
      };
    });

    const updates = ratedResults.map(({ entry }, playerIndex) => {
      const state = existingStates.get(entry.player) ?? {
        accountId: entry.player,
        mode: 'qualifying' as const,
        ...DEFAULT_STATE,
      };
      const prepared = prepareQualifyingState(state, state.lastRatedAt, ratedAt);
      const updated = applyQualifyingCupResult(prepared, entry.player, entry.rank, participants, playerIndex);

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
        lastRatedAt: ratedAt,
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
        lastRatedAt: u.lastRatedAt,
        lastFetchedAt: u.lastFetchedAt,
        updatedAt: new Date(),
      });
    }

    pendingStateUpdates.push(...updates);
    const updatesByAccount = new Map(updates.map(update => [update.accountId, update]));
    pendingHistory.push(...allResults.map(entry => {
      const update = updatesByAccount.get(entry.player);
      const currentState = existingStates.get(entry.player) ?? DEFAULT_STATE;
      return {
        accountId: entry.player,
        cupId: day.cupId,
        cotdDate: day.cotdDate,
        mode: 'qualifying' as const,
        rating: update?.rating ?? currentState.rating,
        rd: update?.rd ?? currentState.rd,
        rank: entry.rank,
        isFlagged: !updatesByAccount.has(entry.player),
      };
    }));

    // Keep processed marker writes outside the heavy flush cycle for correctness.
    const tMark0 = nowMs();
    await markCotdDayProcessed(day.cupId, cardinal);
    totalMarkMs += nowMs() - tMark0;
    lastVisitedCupId = day.cupId;
    processedCount++;
    console.log(
      `[recalculate] (${processedCount}) Processed cup ${day.cupId} (${day.name}) with ${allResults.length} players`
    );

    if (processedCount % FLUSH_EVERY_CUPS === 0) {
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
  await flushPending();
  if (lastVisitedCupId !== null) {
    progress = { lastCupId: lastVisitedCupId };
    saveProgress(progress);
  }
  invalidateRankThresholdCache();

  try {
    if (stopRequested) {
      console.log(`[recalculate] Exited cleanly. Processed ${processedCount} cups before stopping.`);
    } else {
      console.log(`[recalculate] Finished! Successfully recalculated ratings across ${processedCount} cups.`);
      if (existsSync(PROGRESS_FILE)) unlinkSync(PROGRESS_FILE);
    }
  } finally {
    const elapsedMs = nowMs() - runStartMs;
    const elapsedSeconds = elapsedMs / 1000;
    const timedMs = totalUpsertMs + totalHistoryMs + totalMarkMs;
    const averageCupSeconds = processedCount > 0 ? elapsedSeconds / processedCount : 0;

    console.log('[recalculate] Run metrics:');
    console.log(`  wall time: ${elapsedSeconds.toFixed(1)}s`);
    console.log(`  cups processed: ${processedCount} / ${totalCupsToProcess}`);
    console.log(`  average throughput: ${processedCount > 0 ? (processedCount / elapsedSeconds).toFixed(2) : '0.00'} cups/s (${averageCupSeconds.toFixed(2)}s/cup)`);
    console.log(`  state rows written: ${totalStateRowsWritten}`);
    console.log(`  history rows written: ${totalHistoryRowsWritten}`);
    console.log(`  state writes: ${(totalUpsertMs / 1000).toFixed(1)}s`);
    console.log(`  history writes: ${(totalHistoryMs / 1000).toFixed(1)}s`);
    console.log(`  processed markers: ${(totalMarkMs / 1000).toFixed(1)}s`);
    console.log(`  compute/setup/other: ${Math.max(0, (elapsedMs - timedMs) / 1000).toFixed(1)}s`);
  }
}

main().catch(error => {
  console.error('[recalculate] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
