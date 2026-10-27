// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, mock, test } from 'bun:test';

let activePlayers: { rating: number }[] = [];
let totalPlayers = 0;
let thresholdRows: { rankIndex: number; rating: number }[] = [];
let divisionSamples: { rating: number; rank: number; fieldSize: number }[] = [];

const database = {
  select(selection: Record<string, unknown>) {
    return {
      from() {
        return {
          where() {
            if ('count' in selection) return Promise.resolve([{ count: totalPlayers }]);
            return {
              orderBy: () => Promise.resolve(activePlayers),
            };
          },
        };
      },
    };
  },
  $with() {
    return { as: () => ({}) };
  },
  with() {
    return {
      select() {
        return {
          from() {
            return { where: () => Promise.resolve(thresholdRows) };
          },
        };
      },
    };
  },
};

const getRecentCotdDivisionSamples = mock(async () => divisionSamples);
mock.module('../src/db', () => ({
  db: database,
  getRecentCotdDivisionSamples,
}));

const {
  formatTopPercentage,
  getCotdDivisionEstimate,
  getNextRankGoal,
  getPlayerTier,
  getRankDivisionRatingRanges,
  getRankDivisionRatingRangesFromRatings,
  getRankLeaderboardPositionRange,
  getRankThresholdBands,
  invalidateRankThresholdCache,
  TRACKMANIA_RANKS,
} = await import('../src/services/rankService');

test('leaderboard percentile ranges validate inputs and include tier boundaries', () => {
  expect(getRankLeaderboardPositionRange('trackmaster', 1_000)).toEqual({
    firstRank: 1,
    lastRank: 1,
  });
  expect(getRankLeaderboardPositionRange('master-3', 1_000)).toEqual({
    firstRank: 2,
    lastRank: 5,
  });
  expect(getRankLeaderboardPositionRange('bronze-1', 1_000)).toEqual({
    firstRank: 989,
    lastRank: 1_000,
  });
  expect(getRankLeaderboardPositionRange('bronze-1', 0)).toEqual({
    firstRank: 1,
    lastRank: 0,
  });
  expect(() => getRankLeaderboardPositionRange('unknown', 10)).toThrow('Unknown competitive rank');
  expect(() => getRankLeaderboardPositionRange('trackmaster', -1)).toThrow('non-negative integer');
  expect(() => getRankLeaderboardPositionRange('trackmaster', 1.5)).toThrow('non-negative integer');
});

test('top percentages use appropriate precision', () => {
  expect(formatTopPercentage(0.425)).toBe('0.4');
  expect(formatTopPercentage(12.345)).toBe('12.35');
});

test('division rating ranges handle empty input, the top rank, and invalid ranks', () => {
  const ratings = Array.from({ length: 1_300 }, (_, index) => 3_000 - index);
  const topRank = TRACKMANIA_RANKS[0];
  const masterThree = TRACKMANIA_RANKS[1];

  expect(getRankDivisionRatingRangesFromRatings(topRank, 0, ratings)).toEqual([]);
  expect(getRankDivisionRatingRangesFromRatings(topRank, ratings.length, [])).toEqual([]);
  expect(getRankDivisionRatingRangesFromRatings(topRank, ratings.length, ratings)).toEqual([
    { division: 1, startRating: 3000, endRating: 3000 },
    { division: 2, startRating: 3000, endRating: 3000 },
    { division: 3, startRating: 3000, endRating: 3000 },
    { division: 4, startRating: 3000, endRating: 3000 },
  ]);
  expect(getRankDivisionRatingRangesFromRatings(masterThree, ratings.length, ratings)).toHaveLength(4);
  expect(() => getRankDivisionRatingRangesFromRatings(
    { ...masterThree, code: 'unknown' },
    ratings.length,
    ratings,
  )).toThrow('Unknown competitive rank');
});

test('player tiers handle unranked, ranked, and rating-based positions', async () => {
  const emptyTier = await getPlayerTier(0, 1, 0);
  expect(emptyTier.fullName).toBe('Bronze 1 Division I');
  expect(emptyTier.topPercentage).toBe(100);

  const trackmaster = await getPlayerTier(0, 1, 1_300);
  expect(trackmaster.fullName).toBe('Trackmaster');
  expect(trackmaster.divisionRoman).toBe('');

  const master = await getPlayerTier(0, 40, 1_300);
  expect(master.fullName).toBe('Master 1 Division III');
  expect(master.division).toBe(3);

  activePlayers = [{ rating: 2_000 }, { rating: 1_500 }, { rating: 1_000 }];
  invalidateRankThresholdCache();
  expect((await getPlayerTier(1_750)).fullName).toBe('Gold 1 Division II');
  expect((await getPlayerTier(500)).topPercentage).toBeCloseTo(133.33333333333334);
});

test('next-rank goals cover divisions, promotion, and Trackmaster leaderboard targets', () => {
  const masterOne = TRACKMANIA_RANKS.find(rank => rank.code === 'master-1')!;
  const divisionTwo = {
    rank: masterOne,
    division: 2,
    divisionRoman: 'II',
    topPercentage: 4,
    fullName: 'Master 1 Division II',
    iconPath: 'images/m1.png',
  };
  expect(getNextRankGoal(100, 1_000, divisionTwo)).toEqual({
    name: 'Master 1 Division III',
    rank: 36,
  });
  expect(getNextRankGoal(100, 1_000, { ...divisionTwo, division: 4 })).toEqual({
    name: 'Master 2',
    rank: 19,
  });

  const trackmaster = {
    ...divisionTwo,
    rank: TRACKMANIA_RANKS[0],
    fullName: 'Trackmaster',
  };
  expect(getNextRankGoal(1, 1_000, trackmaster)).toBeNull();
  expect(getNextRankGoal(7, 1_000, trackmaster)).toEqual({ name: 'Next player (#6)', rank: 6 });
  expect(getNextRankGoal(27, 1_000, trackmaster)).toEqual({ name: 'Top 20', rank: 20 });

  expect(() => getNextRankGoal(10, 1_000, {
    ...divisionTwo,
    rank: { ...masterOne, code: 'unknown' },
  })).toThrow('Unknown competitive rank');
  const topRank = TRACKMANIA_RANKS.shift();
  try {
    expect(() => getNextRankGoal(10, 1_000, {
      ...divisionTwo,
      rank: TRACKMANIA_RANKS[0]!,
      division: 4,
    })).toThrow('No higher rank exists');
  } finally {
    if (topRank) TRACKMANIA_RANKS.unshift(topRank);
  }
});

test('active-player division ranges use the cached eligible leaderboard', async () => {
  activePlayers = Array.from({ length: 1_300 }, (_, index) => ({ rating: 3_000 - index }));
  invalidateRankThresholdCache();

  const ranges = await getRankDivisionRatingRanges('master-3');
  expect(ranges).toHaveLength(4);
  expect(ranges[0]?.endRating).toBeGreaterThanOrEqual(ranges[0]?.startRating ?? 0);
  expect(await getRankDivisionRatingRanges('master-3', 1_300)).toEqual(ranges);
  await expect(getRankDivisionRatingRanges('unknown')).rejects.toThrow('Unknown competitive rank');
});

test('COTD division estimates cache samples and refresh after invalidation', async () => {
  divisionSamples = [{ rating: 2_000, rank: 64, fieldSize: 1_000 }];
  getRecentCotdDivisionSamples.mockClear();
  invalidateRankThresholdCache();

  expect(await getCotdDivisionEstimate(2_000)).toBe(1);
  expect(await getCotdDivisionEstimate(2_000)).toBe(1);
  expect(getRecentCotdDivisionSamples).toHaveBeenCalledTimes(1);

  invalidateRankThresholdCache();
  divisionSamples = [{ rating: 2_000, rank: 65, fieldSize: 1_000 }];
  expect(await getCotdDivisionEstimate(2_000)).toBe(2);
  expect(getRecentCotdDivisionSamples).toHaveBeenCalledTimes(2);
});

test('rank threshold bands handle empty data, cached results, and missing cutoffs', async () => {
  totalPlayers = 0;
  thresholdRows = [];
  invalidateRankThresholdCache();
  expect(await getRankThresholdBands()).toEqual([]);

  totalPlayers = 1_300;
  thresholdRows = Array.from({ length: totalPlayers }, (_, rankIndex) => ({
    rankIndex,
    rating: 3_000 - rankIndex,
  }));
  invalidateRankThresholdCache();
  const bands = await getRankThresholdBands();
  expect(bands).toHaveLength(TRACKMANIA_RANKS.length);
  expect(bands[0]).toEqual({
    rank: TRACKMANIA_RANKS[0],
    maxRating: 3_050,
    minRating: 3_000,
  });
  expect(await getRankThresholdBands()).toBe(bands);

  invalidateRankThresholdCache();
  thresholdRows = [];
  await expect(getRankThresholdBands()).rejects.toThrow('top active player rating');

  invalidateRankThresholdCache();
  thresholdRows = [{ rankIndex: 0, rating: 3_000 }];
  await expect(getRankThresholdBands()).rejects.toThrow('Could not load rank threshold rating');
});
