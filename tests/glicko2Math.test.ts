// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { updateGlicko2 } from '../src/services/glicko2Math';

test('matches Glickman’s published Glicko-2 example', () => {
  const result = updateGlicko2(1500, 200, 0.06, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ], 0.5);

  expect(result.rating).toBeCloseTo(1464.06, 1);
  expect(result.rd).toBeCloseTo(151.52, 1);
  expect(result.vol).toBeCloseTo(0.05999, 4);
});

test('rejects invalid volatility and tau domains', () => {
  expect(() => updateGlicko2(1500, 100, 0, [], 0.5)).toThrow();
  expect(() => updateGlicko2(1500, 100, 0.06, [], 0)).toThrow();
});

test('rating evidence multiplier changes rating evidence independently of opponent information', () => {
  const standard = updateGlicko2(1500, 100, 0.06, [
    { rating: 1500, rd: 100, score: 1, weight: 1 },
  ]);
  const strongerEvidence = updateGlicko2(1500, 100, 0.06, [
    { rating: 1500, rd: 100, score: 1, weight: 1, ratingWeight: 1.25 },
  ]);

  expect(strongerEvidence.rating).toBeGreaterThan(standard.rating);
});