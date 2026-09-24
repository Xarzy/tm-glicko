import { nadeoGet } from './nadeoClient';
import { applySingleQualifyingResult } from './glickoService.ts';
import {
  insertCotdDaysIfNew, getPendingCotdDays, setQualifierChallengeId,
  markCotdDayProcessed, getStatesForAccounts, batchUpsertRatingStates,
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
export async function processPendingDays(batchSize = 20): Promise<number> {
  console.log("getting pending days")
  const pending = await getPendingCotdDays(batchSize);
  for (const day of pending) {
    console.log("processing day", JSON.stringify(day));
    await processCotdDay(day);
  }
  return pending.length; // caller loops while this is > 0
}

async function processCotdDay(day: SelectCotdDay) {
  let challengeId = day.qualifierChallengeId;
  console.log("challengeId", challengeId);

  if (!challengeId) {
    console.log("getting rounds for cup", day.cupId);
    const rounds = await nadeoGet<CompetitionRound[]>(
      `https://meet.trackmania.nadeo.club/api/competitions/${day.competitionId}/rounds`
    );
    console.log("rounds", JSON.stringify(rounds));
    const qualRound = rounds?.find(r => r.qualifierChallengeId);
    if (!qualRound?.qualifierChallengeId) {
      console.warn(`[ingest] no qualifier round for cup ${day.cupId} (${day.name}), skipping`);
      await markCotdDayProcessed(day.cupId, 0);
      return;
    }
    challengeId = qualRound.qualifierChallengeId;
    await setQualifierChallengeId(day.cupId, challengeId);
  }

  const allResults: { player: string; rank: number }[] = [];
  let offset = 0;
  let cardinal = Infinity;

  console.log("looping through leaderboard")
  while (allResults.length < cardinal) {
    console.log("getting leaderboard for challenge", challengeId, "offset", offset);
    const page = await nadeoGet<ChallengeLeaderboardResponse>(
      `https://meet.trackmania.nadeo.club/api/challenges/${challengeId}/leaderboard?length=100&offset=${offset}`
    );
    console.log("page", JSON.stringify(page));
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

  console.log("getting existing states for", allResults.length, "players");
  const existingStates = await getStatesForAccounts(allResults.map(r => r.player));

  console.log("updating states");
  const updates = allResults.map(entry => {
    const state = existingStates.get(entry.player) ?? { accountId: entry.player, mode: 'qualifying' as const, ...DEFAULT_STATE };
    const percentileScore = cardinal > 1 ? (cardinal - entry.rank) / (cardinal - 1) : 0.5;
    const updated = applySingleQualifyingResult(state, percentileScore);
    console.log("updated", JSON.stringify(updated));

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
      lastFetchedAt: null,
    };
  });
  console.log("upserting states")
  await batchUpsertRatingStates(updates);
  console.log("marking processed")
  await markCotdDayProcessed(day.cupId, cardinal);

  console.log(`[ingest] cup ${day.cupId} (${day.name}) — ${allResults.length}/${cardinal} participants`);
}

function isPreferredCotd(cotd: RawCotdEntry): boolean {
  // Pre-July-2021 entries (before multi-cup days existed) likely have no
  // `edition` field at all — treat missing as edition 1, since it was the
  // only cup that day anyway.
  const edition = cotd.edition ?? 1;
  if (edition !== 1) return false;

  const partition = cotd.competition.partition;
  return partition === 'crossplay';
}

function cotdCalendarDate(startDateUnixSeconds: number): string {
  // UTC date as the grouping key. Your sample timestamps were consistently
  // ~17:xx UTC, so this should align cleanly — spot-check if a day ever
  // looks miscounted.
  return new Date(startDateUnixSeconds * 1000).toISOString().slice(0, 10);
}