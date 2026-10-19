import {
  getCotdDayById,
  getCotdResults,
  getEligiblePeakRating,
  getEligibleRatingPlayerCount,
  getPlayerRatingStateIfExists,
  getPlayerRatingStatesByRankRange,
  getRatingRank,
  getRecentEligibleRatingHistory,
  getRecentProcessedCotdDays,
} from '../db';
import {
  MIN_RANKED_COTDS,
  type SelectCotdDay,
  type SelectPlayerRatingState,
} from '../db/schema';
import {
  findAccountIdByUsername,
  findUsernamesByAccountIds,
} from './accountLookup';
import {
  formatTopPercentage,
  getCotdDivisionEstimate,
  getRankLeaderboardPositionRange,
  getPlayerTier,
  getRankThresholdBands,
  TRACKMANIA_RANKS,
  type RankThresholdBand,
  type PlayerRankTierInfo,
} from './rankService';

const DISPLAY_NAME_TTL_MS = 5 * 60 * 1000;
const displayNameCache = new Map<string, { name: string; expiresAt: number }>();
let warnedMissingTrackmaniaOAuth = false;

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

export interface WebsiteCotdResult {
  player: string;
  username: string;
  rank: number;
  score: number | null;
}

export interface WebsiteDataSource {
  rankOptions: { code: string; label: string }[];
  findAccountIdByUsername(username: string): Promise<string | null>;
  getDisplayNames(accountIds: string[]): Promise<Map<string, string>>;
  getLeaderboardPage(page: number, limit: number, tierCode?: string): Promise<{ entries: WebsiteLeaderboardEntry[]; total: number }>;
  getRecentProcessedCotdDays(limit: number): Promise<SelectCotdDay[]>;
  getPlayerProfile(accountId: string): Promise<WebsitePlayerProfile | null>;
  getCotdDetail(cupId: number): Promise<{ day: SelectCotdDay; results: WebsiteCotdResult[] } | null>;
}

async function getDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const now = Date.now();
  const idsToFetch: string[] = [];

  for (const accountId of accountIds) {
    const cached = displayNameCache.get(accountId);
    if (cached && cached.expiresAt > now) names.set(accountId, cached.name);
    else idsToFetch.push(accountId);
  }

  if (idsToFetch.length > 0) {
    if (!process.env.TRACKMANIA_OAUTH_CLIENT_ID || !process.env.TRACKMANIA_OAUTH_CLIENT_SECRET) {
      if (!warnedMissingTrackmaniaOAuth) {
        console.warn('[web] Trackmania OAuth is not configured; displaying account IDs instead of usernames.');
        warnedMissingTrackmaniaOAuth = true;
      }
      return names;
    }

    try {
      const fetchedNames = await findUsernamesByAccountIds(idsToFetch);
      for (const [accountId, name] of fetchedNames) {
        names.set(accountId, name);
        displayNameCache.set(accountId, { name, expiresAt: now + DISPLAY_NAME_TTL_MS });
      }
    } catch (error) {
      console.error('[web] Trackmania display-name lookup failed:', error);
    }
  }

  return names;
}

async function getLeaderboardPage(page: number, limit: number, tierCode?: string) {
  let from = (page - 1) * limit + 1;
  let total = 0;
  if (tierCode) {
    const playerCount = await getEligibleRatingPlayerCount('qualifying');
    const range = getRankLeaderboardPositionRange(tierCode, playerCount);
    total = Math.max(0, range.lastRank - range.firstRank + 1);
    from = range.firstRank + (page - 1) * limit;
    if (total === 0 || from > range.lastRank) return { entries: [], total };
  }

  const { states, total: leaderboardTotal } = await getPlayerRatingStatesByRankRange('qualifying', from, limit);
  if (!tierCode) total = leaderboardTotal;
  const names = await getDisplayNames(states.map(state => state.accountId));
  const entries = await Promise.all(states.map(async (state, index) => ({
    accountId: state.accountId,
    username: names.get(state.accountId) ?? state.accountId,
    rating: state.rating,
    rank: from + index,
    tier: await getPlayerTier(state.rating, from + index, leaderboardTotal),
    previousRating: state.previousRating,
  })));
  return { entries, total };
}

async function getPlayerProfile(accountId: string): Promise<WebsitePlayerProfile | null> {
  const state = await getPlayerRatingStateIfExists(accountId, 'qualifying');
  if (!state) return null;
  const names = await getDisplayNames([accountId]);
  const username = names.get(accountId) ?? accountId;
  if (state.lastProcessedCupId === null || state.matchCount < MIN_RANKED_COTDS) {
    return { status: 'unranked', username, matchCount: state.matchCount };
  }

  const rankResult = await getRatingRank('qualifying', accountId, state.rating);
  if (rankResult.rank < 1 || rankResult.total < 1) {
    throw new Error(`Could not load leaderboard rank for player ${accountId}.`);
  }
  const [tier, peakRating, divisionEstimate, history, rankBands] = await Promise.all([
    getPlayerTier(state.rating, rankResult.rank, rankResult.total),
    getEligiblePeakRating(accountId, 'qualifying'),
    getCotdDivisionEstimate(state.rating),
    getRecentEligibleRatingHistory(accountId, 120),
    getRankThresholdBands(),
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

export const websiteData: WebsiteDataSource = {
  rankOptions: TRACKMANIA_RANKS.map(rank => ({ code: rank.code, label: rank.name })),
  findAccountIdByUsername,
  getDisplayNames,
  getLeaderboardPage,
  getRecentProcessedCotdDays,
  getPlayerProfile,
  getCotdDetail,
};
