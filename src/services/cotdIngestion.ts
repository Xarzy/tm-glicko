import { nadeoGet } from './nadeoClient';
import { applyQualifyingCupResult } from './glickoService.ts';
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

const DEFAULT_STATE = { rating: 1500, rd: 350, vol: 0.06, matchCount: 0, peakRating: 1500, previousRating: null, lastProcessedCupId: null };

interface CupsOfTheDayResponse {
  COTDs: { id: number; competition: { id: number; name: string; startDate: number } }[];
}
interface CompetitionRound { qualifierChallengeId?: number }
interface ChallengeLeaderboardResponse {
  cardinal: number;
  results: { player: string; rank: number }[];
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

  if (!challengeId) {
    console.log("getting rounds for cup", day.cupId);
    const rounds = await nadeoGet<CompetitionRound[]>(
      `https://meet.trackmania.nadeo.club/api/competitions/${day.competitionId}/rounds`
    );
    const qualRound = rounds?.find(r => r.qualifierChallengeId);
    if (!qualRound?.qualifierChallengeId) {
      console.warn(`[ingest] no qualifier round for cup ${day.cupId} (${day.name}), skipping`);
      await markCotdDayProcessed(day.cupId, 0);
      return;
    }
    challengeId = qualRound.qualifierChallengeId;
    await setQualifierChallengeId(day.cupId, challengeId);
  }

  let allResults: { player: string; rank: number }[] = [];
  let cardinal: number;

  const cachedResults = await getChallengeLeaderboard(challengeId);
  if (cachedResults.length > 0) {
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
      allResults.push(...page.results);
      if (page.results.length < 100) break;
      offset += 100;
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

  console.log("updating states");
  const participants = allResults.map(entry => {
    const s = existingStates.get(entry.player) ?? { accountId: entry.player, mode: 'qualifying' as const, ...DEFAULT_STATE };
    return {
      player: entry.player,
      rank: entry.rank,
      rating: s.rating,
      rd: s.rd,
    };
  });

  const updates = allResults.map(entry => {
    const state = existingStates.get(entry.player) ?? { accountId: entry.player, mode: 'qualifying' as const, ...DEFAULT_STATE };
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
  console.log("upserting states")
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
        excluded: troll.excluded, excludedReason: troll.reason ?? null,
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
    if (cached.length > 0) continue;

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
      allResults.push(...page.results);
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

  if (cotd.competition.partition !== 'crossplay') return false;

  const date = new Date(cotd.competition.startDate);
  const dateOnly = date.toISOString().slice(0, 10);

  if (dateOnly >= '2021-04-01' && date.getUTCDate() === 1) {
    return false;
  }

  if (dateOnly >= '2026-02-01' && date.getUTCDay() === 0) {
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
  if (date.getUTCDay() === 0) return { excluded: true, reason: 'sunday' };
  return { excluded: false };
}