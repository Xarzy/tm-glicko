import { nadeoGet } from './nadeoClient';
import {
  applyQualifyingCupResult,
  getRatingSeedRanks,
  isLikelyAbandonedQualifyingRun,
  prepareQualifyingState,
  QUALIFYING_RATING_CONFIG,
} from './glickoService.ts';
import { invalidateRankThresholdCache } from './rankService';
import {
  insertCotdDaysIfNew,
  getPendingCotdDays,
  setQualifierChallengeId,
  markCotdDayProcessed,
  getStatesForAccounts,
  batchUpsertRatingStates,
  cotdDateExists,
  getChallengeLeaderboard,
  saveChallengeLeaderboard,
  getCupsNeedingLeaderboards,
  batchInsertRatingHistory,
} from '../db';
import type { SelectCotdDay } from '../db/schema';

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

interface CupsOfTheDayResponse {
  COTDs: { id: number; competition: { id: number; name: string; startDate: number } }[];
}
interface CompetitionRound {
  qualifierChallengeId?: number;
}
interface ChallengeLeaderboardResponse {
  cardinal: number;
  results: { player: string; rank: number; score?: number; points?: number }[];
}

interface RawCotdEntry {
  id: number;
  edition?: number;
  competition: {
    id: number;
    name: string;
    startDate: number;
    partition?: string | null;
  };
}

// --- Phase 1: discover every cup's metadata, newest→oldest, until exhausted ---
export async function discoverAllCotdDays() {
  let offset = 0;
  const length = 100;
  const seenDates = new Set<string>(); // per-run diagnostic — the real guard is the DB constraint above

  while (true) {
    const page = await nadeoGet<{ COTDs: RawCotdEntry[] }>(
      `https://meet.trackmania.nadeo.club/api/cups-of-the-day?type=cotd&length=${length}&offset=${offset}`
    );
    if (!page || page.COTDs.length === 0) break;

    const toInsert = [];
    for (const c of page.COTDs.filter(isPreferredCotd)) {
      const dateKey = cotdCalendarDate(c.competition.startDate);
      if (seenDates.has(dateKey)) {
        console.warn(`[discover] duplicate preferred COTD for ${dateKey} — cup ${c.id} (${c.competition.name}), skipping`);
        continue;
      }
      seenDates.add(dateKey);
      toInsert.push({
        cupId: c.id,
        cotdDate: dateKey,
        competitionId: c.competition.id,
        name: c.competition.name,
        startDate: new Date(c.competition.startDate * 1000),
      });
    }

    await insertCotdDaysIfNew(toInsert);
    console.log(`[discover] offset=${offset}: +${toInsert.length} preferred (of ${page.COTDs.length} total)`);
    if (page.COTDs.length < length) break;
    offset += length;
  }
  console.log('[discover] done');
}

// --- Phase 2: process pending days, oldest first, in controlled batches ---
export async function processPendingDays(
  batchSize = 20,
  shouldStop?: () => boolean
): Promise<{ processed: number; remainingInBatch: number }> {
  console.log("getting pending days")
  const pending = await getPendingCotdDays(batchSize);
  let processed = 0;
  for (const day of pending) {
    if (shouldStop && shouldStop()) {
      break;
    }
    console.log("processing day", JSON.stringify(day));
    await processCotdDay(day);
    processed++;
  }
  return { processed, remainingInBatch: pending.length - processed };
}

async function processCotdDay(day: SelectCotdDay) {
  let challengeId = day.qualifierChallengeId;
  console.log("challengeId", challengeId);

  let rounds: CompetitionRound[] | null = null;
  const getRounds = async () => {
    if (rounds === null) {
      rounds = await nadeoGet<CompetitionRound[]>(
        `https://meet.trackmania.nadeo.club/api/competitions/${day.competitionId}/rounds`
      );
    }
    return rounds;
  };

  if (!challengeId) {
    console.log("getting rounds for cup", day.cupId);
    rounds = await getRounds();
    const qualRound = rounds?.find(r => r.qualifierChallengeId);
    if (!qualRound?.qualifierChallengeId) {
      console.warn(`[ingest] no qualifier round for cup ${day.cupId} (${day.name}), skipping`);
      await markCotdDayProcessed(day.cupId, 0);
      return;
    }
    challengeId = qualRound.qualifierChallengeId;
    await setQualifierChallengeId(day.cupId, challengeId);
  }

  let allResults: { player: string; rank: number; score: number | null }[] = [];
  let cardinal: number;

  const cachedResults = await getChallengeLeaderboard(challengeId);
  if (cachedResults.length > 0 && cachedResults.every(result => result.score !== null)) {
    console.log(`[ingest] challenge ${challengeId} loaded from DB (${cachedResults.length} records)`);
    allResults = cachedResults;
    cardinal = day.cardinal && day.cardinal > 0 ? day.cardinal : cachedResults.length;
  } else {
    let offset = 0;
    cardinal = Infinity;
    console.log("looping through leaderboard");
    while (allResults.length < cardinal) {
      console.log("getting leaderboard for challenge", challengeId, "offset", offset);
      const page = await nadeoGet<ChallengeLeaderboardResponse>(
        `https://meet.trackmania.nadeo.club/api/challenges/${challengeId}/leaderboard?length=100&offset=${offset}`
      );
      if (!page) break;
      cardinal = page.cardinal;
      allResults.push(...page.results.map(result => ({
        player: result.player,
        rank: result.rank,
        score: result.score ?? result.points ?? null,
      })));
      if (page.results.length < 100) break;
      offset += 100;
    }

    if (allResults.length === 0 && cachedResults.length > 0) {
      allResults = cachedResults;
      cardinal = day.cardinal && day.cardinal > 0 ? day.cardinal : cachedResults.length;
    }

    if (allResults.length === 0) {
      console.warn(`[ingest] no leaderboard data for cup ${day.cupId}, skipping`);
      await markCotdDayProcessed(day.cupId, 0);
      return;
    }

    console.log(`[ingest] saving ${allResults.length} leaderboard records for challenge ${challengeId} to DB`);
    await saveChallengeLeaderboard(challengeId, allResults);
  }

  console.log("getting existing states for", allResults.length, "players");
  const existingStates = await getStatesForAccounts(allResults.map(r => r.player));
  const ratedAt = new Date(day.startDate);

  console.log("updating states");
  const preparedStates = allResults.map(entry => {
    const s = existingStates.get(entry.player) ?? { accountId: entry.player, mode: 'qualifying' as const, ...DEFAULT_STATE };
    return prepareQualifyingState(s, s.lastRatedAt, ratedAt);
  });
  const ratingSeedRanks = getRatingSeedRanks(preparedStates.map(state => state.rating));
  const resultSignals = allResults.map((entry, index) => {
    const state = existingStates.get(entry.player) ?? { ...DEFAULT_STATE };
    return {
      entry,
      index,
      rating: preparedStates[index].rating,
      matchCount: state.matchCount,
      rank: entry.rank,
      ratingSeedRank: ratingSeedRanks[index],
      fieldSize: allResults.length,
    };
  });
  const primaryFlags = new Set(
    resultSignals
      .filter(signal => isLikelyAbandonedQualifyingRun(signal))
      .map(signal => signal.entry.player),
  );
  const ratedResults = resultSignals
    .filter(signal => !primaryFlags.has(signal.entry.player))
    .map(({ entry, index }) => ({ entry, index }));

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
    const state = existingStates.get(entry.player) ?? { accountId: entry.player, mode: 'qualifying' as const, ...DEFAULT_STATE };
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
  const updatesByAccount = new Map(updates.map(update => [update.accountId, update]));
  console.log("upserting states")
  await batchUpsertRatingStates(updates);
  await batchInsertRatingHistory(
    allResults.map(entry => {
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
    })
  );
  invalidateRankThresholdCache();
  console.log("marking processed")
  await markCotdDayProcessed(day.cupId, cardinal);

  console.log(`[ingest] cup ${day.cupId} (${day.name}) — ${allResults.length}/${cardinal} participants`);
}

export async function discoverNewCotdDays(): Promise<number> {
  let offset = 0;
  const length = 100;
  let totalNew = 0;

  while (true) {
    const page = await nadeoGet<{ COTDs: RawCotdEntry[] }>(
      `https://meet.trackmania.nadeo.club/api/cups-of-the-day?type=cotd&length=${length}&offset=${offset}`
    );
    if (!page || page.COTDs.length === 0) break;

    const newRows = [];
    for (const c of page.COTDs.filter(isPreferredCotd)) {
      const dateKey = cotdCalendarDate(c.competition.startDate);
      if (await cotdDateExists(dateKey)) continue;
      const troll = isTrollMapDate(c.competition.startDate);
      newRows.push({
        cupId: c.id, cotdDate: dateKey, competitionId: c.competition.id, name: c.competition.name,
        startDate: new Date(c.competition.startDate * 1000),
      });
    }

    if (newRows.length > 0) {
      await insertCotdDaysIfNew(newRows);
      totalNew += newRows.length;
    } else {
      // A full page with nothing new — assumes cotd_days has no gaps from a prior
      // partial run. If you ever hand-delete rows, use discoverAllCotdDays() instead.
      break;
    }
    if (page.COTDs.length < length) break;
    offset += length;
  }
  return totalNew;
}

export async function fetchMissingLeaderboards(shouldStop?: () => boolean) {
  const cups = await getCupsNeedingLeaderboards();
  console.log(`[leaderboards] Found ${cups.length} cups needing challenge leaderboards.`);

  for (const day of cups) {
    if (shouldStop && shouldStop()) break;

    let challengeId = day.qualifierChallengeId;
    if (!challengeId) {
      const rounds = await nadeoGet<CompetitionRound[]>(
        `https://meet.trackmania.nadeo.club/api/competitions/${day.competitionId}/rounds`
      );
      const qualRound = rounds?.find(r => r.qualifierChallengeId);
      if (!qualRound?.qualifierChallengeId) {
        console.warn(`[leaderboards] No qualifier round for cup ${day.cupId} (${day.name}), skipping`);
        continue;
      }
      challengeId = qualRound.qualifierChallengeId;
      await setQualifierChallengeId(day.cupId, challengeId);
    }

    const cached = await getChallengeLeaderboard(challengeId);
    if (cached.length > 0 && cached.every(result => result.score !== null)) continue;

    let offset = 0;
    let cardinal = Infinity;
    const allResults: { player: string; rank: number }[] = [];

    while (allResults.length < cardinal) {
      if (shouldStop && shouldStop()) break;
      const page = await nadeoGet<ChallengeLeaderboardResponse>(
        `https://meet.trackmania.nadeo.club/api/challenges/${challengeId}/leaderboard?length=100&offset=${offset}`
      );
      if (!page) break;
      cardinal = page.cardinal;
      allResults.push(...page.results.map(result => ({
        player: result.player,
        rank: result.rank,
        score: result.score ?? result.points ?? null,
      })));
      if (page.results.length < 100) break;
      offset += 100;
    }

    if (allResults.length > 0) {
      await saveChallengeLeaderboard(challengeId, allResults);
      console.log(`[leaderboards] Saved ${allResults.length} records for cup ${day.cupId} (${day.name})`);
    }
  }
}

function isPreferredCotd(cotd: RawCotdEntry): boolean {
  const edition = cotd.edition ?? 1;
  if (edition !== 1) return false;
  
  const brokenCotds = [
    '2020-12-10', '2021-04-06', '2021-04-06', '2021-09-08', 
    '2021-11-05', '2021-11-13', '2021-11-14', '2022-01-17', '2023-03-27', '2023-07-02', 
    '2023-12-04', '2024-04-03', '2024-10-15', '2024-12-04', '2025-10-20'
  ]

  const firstOfTheMonthNonTrolls = [
    '2026-09-01', '2026-07-01', '2026-05-01', '2026-03-01',
    '2025-07-01', '2022-12-01', '2021-12-01', '2021-05-01'
  ]

  if (cotd.competition.partition !== 'crossplay') return false;

  const date = new Date(cotd.competition.startDate * 1000);
  const dateOnly = date.toISOString().slice(0, 10);

  if (dateOnly >= '2021-04-01' && (date.getUTCDate() === 1 && !firstOfTheMonthNonTrolls.includes(dateOnly))) {
    return false;
  }

  if (brokenCotds.includes(dateOnly)) {
    return false;
  }

  return true;
}

function cotdCalendarDate(startDateUnixSeconds: number): string {
  // UTC date as the grouping key. Your sample timestamps were consistently
  // ~17:xx UTC, so this should align cleanly — spot-check if a day ever
  // looks miscounted.
  return new Date(startDateUnixSeconds * 1000).toISOString().slice(0, 10);
}

function isTrollMapDate(startDateUnixSeconds: number): { excluded: boolean; reason?: string } {
  const date = new Date(startDateUnixSeconds * 1000); // UTC, matching cotdCalendarDate's convention
  if (date.getUTCDate() === 1) return { excluded: true, reason: 'first-of-month' };
  return { excluded: false };
}