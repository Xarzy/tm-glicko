// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { applyQualifyingCupResult } from '../src/services/glickoService';
import { getUncertaintyCategory } from '../src/services/ratingPresentation';

const baseState = { rating: 1500, rd: 100, vol: 0.06, matchCount: 500 };

function resultAgainstOpponent(opponentRating: number, playerRank: number): number {
  return applyQualifyingCupResult(
    baseState,
    'player',
    playerRank,
    [
      { player: 'player', rank: playerRank, rating: baseState.rating, rd: baseState.rd },
      { player: 'opponent', rank: playerRank === 1 ? 2 : 1, rating: opponentRating, rd: 100 },
    ],
  ).rating;
}

test('beating a stronger opponent is worth more than beating a weaker opponent', () => {
  expect(resultAgainstOpponent(2900, 1)).toBeGreaterThan(resultAgainstOpponent(1500, 1));
});

test('losing to a stronger opponent is less punitive than losing to a weaker opponent', () => {
  expect(resultAgainstOpponent(2900, 2)).toBeGreaterThan(resultAgainstOpponent(1500, 2));
});

test('adjacent top placements do not create an oversized rating jump', () => {
  const field = [
    { player: 'first', rank: 1, rating: 2850, rd: 60 },
    { player: 'second', rank: 2, rating: 2785, rd: 60 },
    ...Array.from({ length: 498 }, (_, index) => ({
      player: `opponent-${index}`,
      rank: index + 3,
      rating: 1500,
      rd: 100,
    })),
  ];
  const first = applyQualifyingCupResult({ rating: 2850, rd: 60, vol: 0.06 }, 'first', 1, field, 0);
  const second = applyQualifyingCupResult({ rating: 2785, rd: 60, vol: 0.06 }, 'second', 2, field, 1);

  expect(first.rating - second.rating).toBeLessThan(65.5);
});

test('players need sustained cups for full rating impact', () => {
  const field = [
    { player: 'player', rank: 1, rating: 1500, rd: 100 },
    { player: 'opponent', rank: 2, rating: 1500, rd: 100 },
  ];
  const newcomer = applyQualifyingCupResult(
    { rating: 1500, rd: 100, vol: 0.06, matchCount: 0 },
    'player',
    1,
    field,
  );
  const established = applyQualifyingCupResult(
    { rating: 1500, rd: 100, vol: 0.06, matchCount: 500 },
    'player',
    1,
    field,
  );

  expect(newcomer.rating - 1500).toBeLessThan(established.rating - 1500);
});

test('field size does not multiply one tournament into hundreds of matches', () => {
  const smallField = applyQualifyingCupResult(
    baseState,
    'player',
    1,
    [
      { player: 'player', rank: 1, rating: 1500, rd: 100 },
      { player: 'opponent-1', rank: 2, rating: 1500, rd: 100 },
    ],
  );
  const largeField = applyQualifyingCupResult(
    baseState,
    'player',
    1,
    [
      { player: 'player', rank: 1, rating: 1500, rd: 100 },
      ...Array.from({ length: 99 }, (_, index) => ({
        player: `opponent-${index + 1}`,
        rank: index + 2,
        rating: 1500,
        rd: 100,
      })),
    ],
  );

  expect(largeField.rating).toBeGreaterThan(baseState.rating);
  expect(largeField.rating).toBeLessThan(smallField.rating * 1.1);
  expect(largeField.rd).toBeGreaterThan(30);
});

test('top rating requires sustained participation', () => {
  let state = { rating: 1500, rd: 350, vol: 0.06, matchCount: 0 };
  const field = [
    { player: 'player', rank: 1, rating: 1500, rd: 350 },
    ...Array.from({ length: 499 }, (_, index) => ({
      player: `opponent-${index}`,
      rank: index + 2,
      rating: 1500,
      rd: 350,
    })),
  ];

  for (let cup = 0; cup < 125; cup++) {
    const updated = applyQualifyingCupResult(state, 'player', 1, field, 0);
    state = { ...updated, matchCount: state.matchCount + 1 };
  }

  expect(state.rating).toBeLessThan(2900);

  for (let cup = 125; cup < 500; cup++) {
    const updated = applyQualifyingCupResult(state, 'player', 1, field, 0);
    state = { ...updated, matchCount: state.matchCount + 1 };
  }

  expect(state.rating).toBeGreaterThan(2900);
  expect(state.rating).toBeLessThan(3400);
});

test('RD categories use the requested boundaries', () => {
  expect(getUncertaintyCategory(99.99)).toBe('very low');
  expect(getUncertaintyCategory(100)).toBe('low');
  expect(getUncertaintyCategory(130)).toBe('low-moderate');
  expect(getUncertaintyCategory(150)).toBe('moderate');
  expect(getUncertaintyCategory(175)).toBe('moderate-high');
  expect(getUncertaintyCategory(200)).toBe('high');
  expect(getUncertaintyCategory(225)).toBe('very high');
  expect(getUncertaintyCategory(250)).toBe('extremely high');
});