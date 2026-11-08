import {
  getCotdDayById,
  getCotdResults,
  findAccountIdByDisplayName,
  getEligiblePeakRating,
  getEligibleRatingPlayerCount,
  getDuelCupResults,
  getLatestProcessedCotdAt,
  getDailyUpdateStatus,
  getPlayerCotdResults as queryPlayerCotdResults,
  getPlayerRatingStateIfExists,
  getPlayerRatingStatesByRankRange,
  getRatingRank,
  getRecentEligibleRatingHistory,
  getRecentProcessedCotdDays,
  searchPlayerDisplayNames,
  savePlayerDisplayNames,
} from '../../db';
import {
  MIN_RANKED_COTDS,
  type SelectCotdDay,
  type SelectPlayerRatingState,
} from '../../db/schema';
import {
  findAccountIdsByUsernames,
  findUsernamesByAccountIds,
} from '../accountLookup';
import {
  getDisplayNames as getCachedDisplayNames,
  refreshPlayerDisplayNames,
} from '../playerDisplayNames';
import {
  formatTopPercentage,
  getCotdDivisionEstimate,
  getRankLeaderboardPositionRange,
  getPlayerTier,
  getRankThresholdBands,
  TRACKMANIA_RANKS,
  type RankThresholdBand,
  type PlayerRankTierInfo,
} from '../rankService';
import { timeWebStage } from './timing';

const PLAYER_SEARCH_FALLBACK_LIMIT = 250;

export interface WebsitePlayerHistoryPoint {
  cupId: number;
  cotdDate: string;
  name: string;
  cardinal: number | null;
  rank: number | null;
  rating: number;
  ratingChange: number | null;
}

export type WebsitePlayerProfile =
  | { status: 'unranked'; username: string; matchCount: number }
  | {
    status: 'ranked';
    username: string;
    state: SelectPlayerRatingState;
    rank: number;
    total: number;
    tier: PlayerRankTierInfo;
    topPercentageText: string;
    peakRating: number | null;
    divisionEstimate: number | null;
    history: WebsitePlayerHistoryPoint[];
    rankBands: RankThresholdBand[];
  };

export interface WebsiteLeaderboardEntry {
  accountId: string;
  username: string;
  rating: number;
  rank: number;
  tier: PlayerRankTierInfo;
  previousRating: number | null;
}

export interface WebsitePlayerSearchSuggestion {
  accountId: string;
  username: string;
  rating: number;
  rank: number;
}

export interface WebsiteCotdResult {
  player: string;
  username: string;
  rank: number;
  score: number | null;
}

export interface WebsiteDuelCupResult {
  cupId: number;
  cotdDate: string;
  name: string;
  firstRank: number;
  secondRank: number;
}

export interface WebsitePlayerCotdResult {
  cupId: number;
  cotdDate: string;
  name: string;
  rank: number | null;
  rating: number;
  ratingChange: number | null;
}

export interface WebsitePlayerCotdPage {
  results: WebsitePlayerCotdResult[];
  total: number;
}

export interface WebsiteDuelCupPage {
  results: WebsiteDuelCupResult[];
  total: number;
  firstWins: number;
  secondWins: number;
  draws: number;
}

export interface WebsiteDuelDateRange {
  startDate: string | null;
  endDate: string | null;
}

export interface WebsiteDailyUpdateStatus {
  latestRun: { id: number; status: 'running' | 'succeeded' | 'failed'; startedAt: Date; completedAt: Date | null } | null;
  lastSuccessfulRun: { id: number; status: 'running' | 'succeeded' | 'failed'; startedAt: Date; completedAt: Date | null } | null;
}

export interface WebsiteDataSource {
  rankOptions: { code: string; label: string }[];
  getLatestProcessedCotdAt(): Promise<Date | null>;
  getDailyUpdateStatus(): Promise<WebsiteDailyUpdateStatus>;
  findAccountIdByUsername(username: string): Promise<string | null>;
  searchPlayerSuggestions(query: string, limit: number): Promise<WebsitePlayerSearchSuggestion[]>;
  getDisplayNames(accountIds: string[]): Promise<Map<string, string>>;
  getLeaderboardPage(page: number, limit: number, tierCode?: string): Promise<{ entries: WebsiteLeaderboardEntry[]; total: number }>;
  getRecentProcessedCotdDays(limit: number): Promise<SelectCotdDay[]>;
  getPlayerProfile(accountId: string): Promise<WebsitePlayerProfile | null>;
  getPlayerCotdResults(accountId: string, page: number, limit: number): Promise<{ results: WebsitePlayerCotdResult[]; total: number }>;
  getCotdDetail(cupId: number): Promise<{ day: SelectCotdDay; results: WebsiteCotdResult[] } | null>;
  getPlayerRatingTrend(accountId: string, dateRange: WebsiteDuelDateRange): Promise<WebsitePlayerHistoryPoint[]>;
  getDuelCupResults(firstAccountId: string, secondAccountId: string, page: number, limit: number, dateRange: WebsiteDuelDateRange): Promise<WebsiteDuelCupPage>;
}

async function getDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
  return getCachedDisplayNames(accountIds);
}

async function findAccountIdByUsername(username: string): Promise<string | null> {
  const cachedAccountId = await findAccountIdByDisplayName(username);
  if (cachedAccountId) return cachedAccountId;

  const accountIds = await timeWebStage(
    'Trackmania exact username fallback',
    () => findAccountIdsByUsernames([username]),
  );
  const accountId = accountIds.get(username.toLowerCase()) ?? null;
  if (accountId) await refreshPlayerDisplayNames([accountId]);
  return accountId;
}

async function getLeaderboardPage(page: number, limit: number, tierCode?: string) {
  let from = (page - 1) * limit + 1;
  let total = 0;
  if (tierCode) {
    const playerCount = await timeWebStage(
      'leaderboard eligible-player count query',
      () => getEligibleRatingPlayerCount('qualifying'),
    );
    const range = getRankLeaderboardPositionRange(tierCode, playerCount);
    total = Math.max(0, range.lastRank - range.firstRank + 1);
    from = range.firstRank + (page - 1) * limit;
    if (total === 0 || from > range.lastRank) return { entries: [], total };
  }

  const { states, total: leaderboardTotal } = await timeWebStage(
    'leaderboard page query',
    () => getPlayerRatingStatesByRankRange('qualifying', from, limit),
  );
  if (!tierCode) total = leaderboardTotal;
  const names = await timeWebStage(
    'leaderboard display names',
    () => getDisplayNames(states.map(state => state.accountId)),
  );
  const entries = await timeWebStage('leaderboard tier calculation', () =>
    Promise.all(states.map(async (state, index) => ({
      accountId: state.accountId,
      username: names.get(state.accountId) ?? state.accountId,
      rating: state.rating,
      rank: from + index,
      tier: await getPlayerTier(state.rating, from + index, leaderboardTotal),
      previousRating: state.previousRating,
    })))
  );
  return { entries, total };
}

async function searchPlayerSuggestions(query: string, limit: number): Promise<WebsitePlayerSearchSuggestion[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2 || !Number.isInteger(limit) || limit < 1) return [];
  const matches = await timeWebStage(
    'player display-name database search',
    () => searchPlayerDisplayNames(normalizedQuery, Math.min(limit, 10)),
  );
  if (matches.length > 0) {
    return matches.map(({ displayName, ...player }) => ({ ...player, username: displayName }));
  }

  const { states } = await timeWebStage(
    'player search fallback candidate query',
    () => getPlayerRatingStatesByRankRange('qualifying', 1, PLAYER_SEARCH_FALLBACK_LIMIT),
  );
  const candidateNames = await timeWebStage(
    'Trackmania player search fallback names',
    () => findUsernamesByAccountIds(states.map(state => state.accountId), {
      minDelayMs: 1_000,
      onBatchResults: async names => {
        await savePlayerDisplayNames(
          [...names].map(([accountId, displayName]) => ({ accountId, displayName })),
        );
      },
    }),
  );

  return states.flatMap((state, index) => {
    const username = candidateNames.get(state.accountId);
    if (!username?.toLowerCase().includes(normalizedQuery)) return [];
    return [{
      accountId: state.accountId,
      username,
      rating: state.rating,
      rank: index + 1,
    }];
  }).slice(0, Math.min(limit, 10));
}

async function getPlayerProfile(accountId: string): Promise<WebsitePlayerProfile | null> {
  const state = await timeWebStage(
    'player state query',
    () => getPlayerRatingStateIfExists(accountId, 'qualifying'),
  );
  if (!state) return null;
  const names = await timeWebStage('player display name', () => getDisplayNames([accountId]));
  const username = names.get(accountId) ?? accountId;
  if (state.lastProcessedCupId === null || state.matchCount < MIN_RANKED_COTDS) {
    return { status: 'unranked', username, matchCount: state.matchCount };
  }

  const rankResult = await timeWebStage(
    'player rank query',
    () => getRatingRank('qualifying', accountId, state.rating),
  );
  if (rankResult.rank < 1 || rankResult.total < 1) {
    throw new Error(`Could not load leaderboard rank for player ${accountId}.`);
  }
  const [tier, peakRating, divisionEstimate, history, rankBands] = await Promise.all([
    timeWebStage('player tier calculation', () =>
      getPlayerTier(state.rating, rankResult.rank, rankResult.total)),
    timeWebStage('player peak-rating query', () =>
      getEligiblePeakRating(accountId, 'qualifying')),
    timeWebStage('COTD division estimate', () =>
      getCotdDivisionEstimate(state.rating)),
    timeWebStage('player rating-history query', () =>
      getRecentEligibleRatingHistory(accountId, 120)),
    timeWebStage('chart rank-band query', () =>
      getRankThresholdBands()),
  ]);

  return {
    status: 'ranked',
    username,
    state,
    rank: rankResult.rank,
    total: rankResult.total,
    tier,
    topPercentageText: formatTopPercentage(tier.topPercentage),
    peakRating,
    divisionEstimate,
    history,
    rankBands,
  };
}

async function getPlayerRatingTrend(
  accountId: string,
  dateRange: WebsiteDuelDateRange,
): Promise<WebsitePlayerHistoryPoint[]> {
  return timeWebStage('duel player rating trend query', () =>
    getRecentEligibleRatingHistory(accountId, 500, 'qualifying', dateRange.startDate, dateRange.endDate));
}

async function getCotdDetail(cupId: number) {
  const day = await getCotdDayById(cupId);
  if (!day?.processedAt) return null;

  const results = await getCotdResults(cupId, 100);
  const names = await getDisplayNames(results.map(result => result.player));
  return {
    day,
    results: results.map(result => ({
      ...result,
      username: names.get(result.player) ?? result.player,
    })),
  };
}

async function getPlayerCotdResultsFromDatabase(accountId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  return timeWebStage('player COTD results page query', () =>
    queryPlayerCotdResults(accountId, limit, offset));
}

async function getDuelCupResultsPage(
  firstAccountId: string,
  secondAccountId: string,
  page: number,
  limit: number,
  dateRange: WebsiteDuelDateRange,
) {
  const offset = (page - 1) * limit;
  return timeWebStage('player duel COTD page query', () =>
    getDuelCupResults(firstAccountId, secondAccountId, limit, offset, dateRange.startDate, dateRange.endDate));
}

export const websiteData: WebsiteDataSource = {
  rankOptions: TRACKMANIA_RANKS.map(rank => ({ code: rank.code, label: rank.name })),
  getLatestProcessedCotdAt,
  getDailyUpdateStatus,
  findAccountIdByUsername,
  searchPlayerSuggestions,
  getDisplayNames,
  getLeaderboardPage,
  getRecentProcessedCotdDays,
  getPlayerProfile,
  getPlayerCotdResults: getPlayerCotdResultsFromDatabase,
  getCotdDetail,
  getPlayerRatingTrend,
  getDuelCupResults: getDuelCupResultsPage,
};
