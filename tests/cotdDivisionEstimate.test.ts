// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { estimateCotdDivision } from '../src/services/cotdDivisionEstimate';

test('estimates COTD divisions in groups of 64 actual placements', () => {
  expect(estimateCotdDivision(2000, [{ rating: 2000, rank: 64, fieldSize: 1000 }])).toBe(1);
  expect(estimateCotdDivision(2000, [{ rating: 2000, rank: 65, fieldSize: 1000 }])).toBe(2);
  expect(estimateCotdDivision(2000, [{ rating: 2000, rank: 128, fieldSize: 1000 }])).toBe(2);
  expect(estimateCotdDivision(2000, [{ rating: 2000, rank: 129, fieldSize: 1000 }])).toBe(3);
});

test('allows many global rating samples to share the same estimated division', () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({
    rating: 2000 + index,
    rank: 100,
    fieldSize: 1000,
  }));

  expect(estimateCotdDivision(2049.5, samples)).toBe(2);
});

test('returns no estimate when there are no valid historical samples', () => {
  expect(estimateCotdDivision(2000, [])).toBeNull();
  expect(estimateCotdDivision(2000, [{ rating: 2000, rank: 1001, fieldSize: 1000 }])).toBeNull();
});
