// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { getPlayerCardSegmentProgress, renderPlayerCard } from '../src/services/playerCardRenderer';
import type { PlayerCardData } from '../src/services/playerCardRenderer';

const topRankRanges = [
  { division: 1, startRating: 0, endRating: 100 },
  { division: 2, startRating: 100, endRating: 200 },
  { division: 3, startRating: 200, endRating: 300 },
  { division: 4, startRating: 300, endRating: 400 },
];

function createCardData(overrides: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    username: `A player's "card" & rank`,
    rank: 20,
    total: 1000,
    rating: 1500,
    latestChange: '-10.0 on 2025-01-01',
    peakRating: 1600,
    tier: {
      rank: {
        code: 'master-1',
        name: 'Master 1',
        shortName: 'M1',
        tierColor: 0x0099ff,
        svgColor: '#039be5',
        topPercent: 4 / 13,
        iconFile: 'm1.png',
      },
      division: 3,
      divisionRoman: 'III',
      topPercentage: 0.8,
      fullName: 'Master 1 Division III',
      iconPath: 'images/m1.png',
    },
    divisionRanges: [
      { division: 1, startRating: 1000, endRating: 1100 },
      { division: 2, startRating: 1100, endRating: 1200 },
      { division: 3, startRating: 1200, endRating: 1300 },
      { division: 4, startRating: 1300, endRating: 1400 },
    ],
    ...overrides,
  };
}

test('Trackmaster progress uses one continuous range from entry rating to #1', () => {
  expect(getPlayerCardSegmentProgress(250, 'trackmaster', 1, {
    division: 1,
    startRating: topRankRanges[0].startRating,
    endRating: topRankRanges[topRankRanges.length - 1].endRating,
  })).toBe(0.625);
});

test('Trackmaster top player fills the progress bar to the #1 rating', () => {
  expect(getPlayerCardSegmentProgress(400, 'trackmaster', 1, {
    division: 1,
    startRating: topRankRanges[0].startRating,
    endRating: topRankRanges[topRankRanges.length - 1].endRating,
  })).toBe(1);
});

test('rank progress fills prior divisions and the current rating interval', () => {
  expect(topRankRanges.map(range =>
    getPlayerCardSegmentProgress(250, 'master-1', 3, range)
  )).toEqual([1, 1, 0.5, 0]);
});

test('renders a compact PNG player card with rank styling', () => {
  const image = renderPlayerCard(createCardData());

  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(image.readUInt32BE(16)).toBe(1600);
  expect(image.readUInt32BE(20)).toBe(528);
});

test('renders Trackmaster progress through the top-player rating with positive changes', () => {
  const data = createCardData({
    rank: 1,
    rating: 1900,
    latestChange: '+5.0',
    tier: {
      ...createCardData().tier,
      rank: {
        ...createCardData().tier.rank,
        code: 'trackmaster',
        name: 'Trackmaster',
        shortName: 'TM',
        iconFile: 'tm.png',
      },
      fullName: 'Trackmaster',
    },
    divisionRanges: [
      { division: 1, startRating: 1500, endRating: 1600 },
      { division: 2, startRating: 1600, endRating: 1700 },
      { division: 3, startRating: 1700, endRating: 1800 },
      { division: 4, startRating: 1800, endRating: 1900 },
    ],
  });

  expect(renderPlayerCard(data).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
});
