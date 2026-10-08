// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import {
  applyQualifyingCupResult,
  isLikelyAbandonedQualifyingRun,
  prepareQualifyingState,
} from '../src/services/glickoService';
import { advanceGlickoRd } from '../src/services/glicko2Math';

test('an unrated elapsed-time state keeps its raw rating and volatility', () => {
  const state = { rating: 2700, rd: 70, vol: 0.06, matchCount: 300 };
  const prepared = prepareQualifyingState(state, new Date('2026-01-01'), new Date('2026-01-15'));

  expect(prepared.rating).toBe(state.rating);
  expect(prepared.vol).toBe(state.vol);
  expect(prepared.rd).toBe(advanceGlickoRd(state.rd, state.vol, 2));
});

test('a qualifying result updates rating and keeps uncertainty in the valid range', () => {
  const state = { rating: 2700, rd: 70, vol: 0.06, matchCount: 500 };
  const updated = applyQualifyingCupResult(
    state,
    'player',
    1,
    [
      { player: 'player', rank: 1, rating: state.rating, rd: state.rd },
      { player: 'opponent', rank: 2, rating: 2700, rd: 70 },
    ],
    0,
  );

  expect(updated.rating).toBeGreaterThan(state.rating);
  expect(updated.rating).toBeLessThan(2720);
  expect(Number.isFinite(updated.rd)).toBe(true);
  expect(updated.rd).toBeGreaterThanOrEqual(30);
  expect(updated.rd).toBeLessThanOrEqual(350);
});

test('flags an experienced high-Elo player whose rank exceeds the Elo-scaled cutoff', () => {
  expect(isLikelyAbandonedQualifyingRun({
    rating: 2200,
    matchCount: 100,
    rank: 2000,
    ratingSeedRank: 100,
    fieldSize: 5000,
  })).toBe(true);
});

test('uses an Elo-scaled percentile cutoff and protects a top-101 finish', () => {
  const result = {
    rating: 2200,
    matchCount: 100,
    rank: 101,
    fieldSize: 5000,
  };

  expect(isLikelyAbandonedQualifyingRun({ ...result, ratingSeedRank: 1 })).toBe(false);
  expect(isLikelyAbandonedQualifyingRun({ ...result, rank: 400, ratingSeedRank: 1 })).toBe(false);
  expect(isLikelyAbandonedQualifyingRun({ ...result, rank: 1500, ratingSeedRank: 1 })).toBe(true);
  expect(isLikelyAbandonedQualifyingRun({ ...result, rank: 1500, ratingSeedRank: 500 })).toBe(false);
  expect(isLikelyAbandonedQualifyingRun({ ...result, rank: 1400, ratingSeedRank: 500 })).toBe(false);
});

test('does not flag provisional players or results inside their Elo-scaled cutoff', () => {
  const result = {
    rating: 2200,
    matchCount: 100,
    rank: 1500,
    ratingSeedRank: 100,
    fieldSize: 5000,
  };

  expect(isLikelyAbandonedQualifyingRun({ ...result, matchCount: 3 })).toBe(false);
  expect(isLikelyAbandonedQualifyingRun({ ...result, rank: 450 })).toBe(false);
});

test('allows callers to tune abandoned-run thresholds', () => {
  expect(isLikelyAbandonedQualifyingRun({
    rating: 2200,
    matchCount: 100,
    rank: 1500,
    ratingSeedRank: 100,
    fieldSize: 5000,
  }, {
    minimumMatchCount: 10,
    minimumRating: 1800,
    seedRankFraction: 0.1,
    minimumSeedRank: 20,
    strongestSeedAbandonedRankPercentile: 5,
    weakestEligibleSeedAbandonedRankPercentile: 25,
  })).toBe(true);
});