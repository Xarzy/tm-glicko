// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { getPlayerTier, TRACKMANIA_RANKS } from '../src/services/rankService';

test('Trackmania rank progression scales the Rocket League percentile cutoffs', () => {
  expect(TRACKMANIA_RANKS.map(rank => rank.name)).toEqual([
    'Trackmaster',
    'Master 3',
    'Master 2',
    'Master 1',
    'Gold 3',
    'Gold 2',
    'Gold 1',
    'Silver 3',
    'Silver 2',
    'Silver 1',
    'Bronze 3',
    'Bronze 2',
    'Bronze 1',
  ]);
  expect(TRACKMANIA_RANKS.map(rank => rank.topPercent)).toEqual([
    0.0005, 0.00425, 0.0185, 0.0525, 0.12, 0.24, 0.415,
    0.605, 0.77, 0.885, 0.955, 0.9875, 1,
  ]);
});

test('Trackmaster is the only division-free rank', async () => {
  const topTier = await getPlayerTier(0, 1, 1_300);
  const masterTier = await getPlayerTier(0, 40, 1_300);

  expect(topTier.fullName).toBe('Trackmaster');
  expect(topTier.divisionRoman).toBe('');
  expect(masterTier.fullName).toBe('Master 1 Division III');
  expect(masterTier.division).toBe(3);
});
