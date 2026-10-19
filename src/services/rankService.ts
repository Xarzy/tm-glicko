import { db, getRecentCotdDivisionSamples } from '../db';
import { MIN_RANKED_COTDS, playerRatingStateTable } from '../db/schema';
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { estimateCotdDivision } from './cotdDivisionEstimate';

export interface RankDefinition {
  code: string;
  name: string;
  shortName: string;
  tierColor: number;  // Hex color for discord embed
  svgColor: string;   // Hex color for SVG zone
  topPercent: number; // Cumulative threshold from top (0 to 1). Lower = higher rank
  iconFile: string;
}

/**
 * Cumulative top-percent cutoffs are interpolated across the 22 Rocket League
 * rank cutoffs to match this 13-rank progression.
 */
export const TRACKMANIA_RANKS: RankDefinition[] = [
  { code: 'trackmaster', name: 'Trackmaster', shortName: 'TM', tierColor: 0x4b972a, svgColor: '#4b972a', topPercent: 0.0005, iconFile: 'tm.png' },
  { code: 'master-3', name: 'Master 3', shortName: 'M3', tierColor: 0xc59514, svgColor: '#c59514', topPercent: 0.00425, iconFile: 'm3.png' },
  { code: 'master-2', name: 'Master 2', shortName: 'M2', tierColor: 0x8e8c89, svgColor: '#8e8c89', topPercent: 0.0185, iconFile: 'm2.png' },
  { code: 'master-1', name: 'Master 1', shortName: 'M1', tierColor: 0xa76935, svgColor: '#a76935', topPercent: 0.0525, iconFile: 'm1.png' },
  { code: 'gold-3', name: 'Gold 3', shortName: 'G3', tierColor: 0xf9a825, svgColor: '#f9a825', topPercent: 0.12, iconFile: 'g3.png' },
  { code: 'gold-2', name: 'Gold 2', shortName: 'G2', tierColor: 0xfbc02d, svgColor: '#fbc02d', topPercent: 0.24, iconFile: 'g2.png' },
  { code: 'gold-1', name: 'Gold 1', shortName: 'G1', tierColor: 0xfdd835, svgColor: '#fdd835', topPercent: 0.415, iconFile: 'g1.png' },
  { code: 'silver-3', name: 'Silver 3', shortName: 'S3', tierColor: 0x757575, svgColor: '#757575', topPercent: 0.605, iconFile: 's3.png' },
  { code: 'silver-2', name: 'Silver 2', shortName: 'S2', tierColor: 0x9e9e9e, svgColor: '#9e9e9e', topPercent: 0.77, iconFile: 's2.png' },
  { code: 'silver-1', name: 'Silver 1', shortName: 'S1', tierColor: 0xbdbdbd, svgColor: '#bdbdbd', topPercent: 0.885, iconFile: 's1.png' },
  { code: 'bronze-3', name: 'Bronze 3', shortName: 'B3', tierColor: 0x5d4037, svgColor: '#5d4037', topPercent: 0.955, iconFile: 'b3.png' },
  { code: 'bronze-2', name: 'Bronze 2', shortName: 'B2', tierColor: 0x6d4c41, svgColor: '#6d4c41', topPercent: 0.9875, iconFile: 'b2.png' },
  { code: 'bronze-1', name: 'Bronze 1', shortName: 'B1', tierColor: 0x795548, svgColor: '#795548', topPercent: 1, iconFile: 'b1.png' },
];

export interface PlayerRankTierInfo {
  rank: RankDefinition;
  division: number; // 1 to 4 (1 = lowest, 4 = highest)
  divisionRoman: string; // 'I', 'II', 'III', 'IV'
  topPercentage: number; // e.g. 3.42 (%)
  fullName: string;
  iconPath: string; // Path to image file in images/
}

export interface NextRankGoal {
  name: string;
  rank: number;
}

export interface RankThresholdBand {
  rank: RankDefinition;
  minRating: number;
  maxRating: number;
}

export interface RankDivisionRatingRange {
  division: number;
  startRating: number;
  endRating: number;
}

export interface RankLeaderboardPositionRange {
  firstRank: number;
  lastRank: number;
}

export function getRankLeaderboardPositionRange(
  rankCode: string,
  totalPlayers: number,
): RankLeaderboardPositionRange {
  const rankIndex = TRACKMANIA_RANKS.findIndex(rank => rank.code === rankCode);
  if (rankIndex < 0) {
    throw new Error(`Unknown competitive rank: ${rankCode}`);
  }
  if (!Number.isInteger(totalPlayers) || totalPlayers < 0) {
    throw new Error('Leaderboard size must be a non-negative integer.');
  }
  if (totalPlayers === 0) return { firstRank: 1, lastRank: 0 };

  const upperPercent = rankIndex === 0 ? 0 : TRACKMANIA_RANKS[rankIndex - 1].topPercent;
  const lowerPercent = TRACKMANIA_RANKS[rankIndex].topPercent;
  return {
    firstRank: rankIndex === 0 ? 1 : Math.floor(upperPercent * totalPlayers) + 2,
    lastRank: Math.min(totalPlayers, Math.floor(lowerPercent * totalPlayers) + 1),
  };
}

export function formatTopPercentage(topPercentage: number): string {
  const options: Intl.NumberFormatOptions = topPercentage < 1
    ? { maximumSignificantDigits: 1 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', options).format(topPercentage);
}

interface ActiveRating {
  rating: number;
}

// In-memory cache of rating-ordered players to avoid heavy database queries on every slash command.
let cachedCutoffs: { timestamp: number; players: ActiveRating[] } | null = null;
let cachedRankBands: { timestamp: number; bands: RankThresholdBand[] } | null = null;
let cachedCotdDivisionSamples: {
  timestamp: number;
  samples: Awaited<ReturnType<typeof getRecentCotdDivisionSamples>>;
} | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getActivePlayers(): Promise<ActiveRating[]> {
  const now = Date.now();
  if (cachedCutoffs && now - cachedCutoffs.timestamp < CACHE_TTL_MS) {
    return cachedCutoffs.players;
  }

  const rows = await db
    .select({ rating: playerRatingStateTable.rating })
    .from(playerRatingStateTable)
    .where(
      and(
        eq(playerRatingStateTable.mode, 'qualifying'),
        isNotNull(playerRatingStateTable.lastProcessedCupId),
        gte(playerRatingStateTable.matchCount, MIN_RANKED_COTDS),
      )
    )
    .orderBy(
      sql`${playerRatingStateTable.rating} DESC`,
      sql`${playerRatingStateTable.accountId} ASC`,
    );

  cachedCutoffs = {
    timestamp: now,
    players: rows,
  };
  return rows;
}

export function invalidateRankThresholdCache(): void {
  cachedCutoffs = null;
  cachedRankBands = null;
  cachedCotdDivisionSamples = null;
}

export async function getCotdDivisionEstimate(rating: number): Promise<number | null> {
  const now = Date.now();
  if (!cachedCotdDivisionSamples || now - cachedCotdDivisionSamples.timestamp >= CACHE_TTL_MS) {
    cachedCotdDivisionSamples = {
      timestamp: now,
      samples: await getRecentCotdDivisionSamples(),
    };
  }

  return estimateCotdDivision(rating, cachedCotdDivisionSamples.samples);
}

export function getRankDivisionRatingRangesFromRatings(
  rank: RankDefinition,
  totalPlayers: number,
  ratings: number[],
): RankDivisionRatingRange[] {
  if (totalPlayers <= 0 || ratings.length === 0) return [];

  const ratingAtPercentile = (percentile: number): number => {
    const index = Math.min(
      ratings.length - 1,
      Math.max(0, Math.floor(percentile * totalPlayers)),
    );
    return ratings[index];
  };

  if (rank.code === 'trackmaster') {
    const startRating = ratingAtPercentile(rank.topPercent);
    const endRating = ratings[0];
    return Array.from({ length: 4 }, (_, index) => ({
      division: index + 1,
      startRating: startRating + ((endRating - startRating) * index) / 4,
      endRating: startRating + ((endRating - startRating) * (index + 1)) / 4,
    }));
  }

  const rankIndex = TRACKMANIA_RANKS.findIndex(rankDefinition => rankDefinition.code === rank.code);
  if (rankIndex < 0) {
    throw new Error(`Unknown competitive rank: ${rank.code}`);
  }

  const upperPercentBound = rankIndex > 0 ? TRACKMANIA_RANKS[rankIndex - 1].topPercent : 0;
  const rankWidth = rank.topPercent - upperPercentBound;

  return Array.from({ length: 4 }, (_, index) => {
    const startPercentile = rank.topPercent - (rankWidth * index) / 4;
    const endPercentile = rank.topPercent - (rankWidth * (index + 1)) / 4;
    return {
      division: index + 1,
      startRating: ratingAtPercentile(startPercentile),
      endRating: ratingAtPercentile(endPercentile),
    };
  });
}

export async function getRankDivisionRatingRanges(
  rankCode: string,
  totalPlayers?: number,
): Promise<RankDivisionRatingRange[]> {
  const players = await getActivePlayers();
  const rank = TRACKMANIA_RANKS.find(rankDefinition => rankDefinition.code === rankCode);
  if (!rank) {
    throw new Error(`Unknown competitive rank: ${rankCode}`);
  }

  return getRankDivisionRatingRangesFromRatings(
    rank,
    totalPlayers ?? players.length,
    players.map(player => player.rating),
  );
}

/**
 * Calculates a player's rank and division dynamically based on their standing / percentile
 * in the active player database.
 */
export async function getPlayerTier(
  playerRating: number,
  playerRankIndex?: number,
  totalPlayersCount?: number
): Promise<PlayerRankTierInfo> {
  const players = playerRankIndex !== undefined && totalPlayersCount !== undefined
    ? []
    : await getActivePlayers();
  const total = totalPlayersCount ?? players.length;

  if (total === 0) {
    const unranked = TRACKMANIA_RANKS[TRACKMANIA_RANKS.length - 1];
    return {
      rank: unranked,
      division: 1,
      divisionRoman: 'I',
      topPercentage: 100,
      fullName: `${unranked.name} Division I`,
      iconPath: `images/${unranked.iconFile}`,
    };
  }

  // 1. Calculate player's top percentile (0 = top player, 1 = bottom player)
  let percentile: number;
  let rankPosition: number;
  if (playerRankIndex !== undefined) {
    rankPosition = playerRankIndex;
    percentile = (playerRankIndex - 1) / total;
  } else {
    // Find rank by the same raw-rating ordering used by the leaderboard.
    let rankPos = 1;
    for (const player of players) {
      if (player.rating > playerRating) rankPos++;
      else break;
    }
    rankPosition = rankPos;
    percentile = (rankPos - 1) / total;
  }

  percentile = Math.max(0, Math.min(0.9999, percentile));
  const topPercentage = (rankPosition / total) * 100;

  // 2. Identify the Rank
  let currentRank = TRACKMANIA_RANKS[TRACKMANIA_RANKS.length - 1];
  let lowerPercentBound = 1.0;
  let upperPercentBound = 0.0;

  for (let i = 0; i < TRACKMANIA_RANKS.length; i++) {
    const r = TRACKMANIA_RANKS[i];
    if (percentile <= r.topPercent) {
      currentRank = r;
      upperPercentBound = i > 0 ? TRACKMANIA_RANKS[i - 1].topPercent : 0.0;
      lowerPercentBound = r.topPercent;
      break;
    }
  }

  if (currentRank.code === 'trackmaster') {
    return {
      rank: currentRank,
      division: 1,
      divisionRoman: '',
      topPercentage,
      fullName: currentRank.name,
      iconPath: `images/${currentRank.iconFile}`,
    };
  }

  // 3. Calculate Division (1 to 4):
  // 1 = lowest in rank, 4 = closest to ranking up
  const rankWidth = lowerPercentBound - upperPercentBound;
  const progressIntoRank = (lowerPercentBound - percentile) / (rankWidth || 1); // 0 (near bottom) to 1 (near top)
  let division = Math.floor(progressIntoRank * 4) + 1;
  division = Math.max(1, Math.min(4, division));

  const romans = ['I', 'II', 'III', 'IV'];
  const divisionRoman = romans[division - 1];

  return {
    rank: currentRank,
    division,
    divisionRoman,
    topPercentage,
    fullName: `${currentRank.name} Division ${divisionRoman}`,
    iconPath: `images/${currentRank.iconFile}`,
  };
}

export function getNextRankGoal(
  rank: number,
  total: number,
  tierInfo: PlayerRankTierInfo,
): NextRankGoal | null {
  if (tierInfo.rank.code === 'trackmaster') {
    if (rank === 1) return null;

    const goalRank = rank <= 10 ? rank - 1 : Math.floor((rank - 1) / 10) * 10;
    return {
      name: rank <= 10 ? `Next player (#${goalRank})` : `Top ${goalRank}`,
      rank: goalRank,
    };
  }

  const rankIndex = TRACKMANIA_RANKS.findIndex(rankDefinition => rankDefinition.code === tierInfo.rank.code);
  if (rankIndex < 0) {
    throw new Error(`Unknown competitive rank: ${tierInfo.rank.code}`);
  }

  const upperPercentBound = rankIndex > 0 ? TRACKMANIA_RANKS[rankIndex - 1].topPercent : 0;
  const lowerPercentBound = tierInfo.rank.topPercent;
  const rankWidth = lowerPercentBound - upperPercentBound;

  if (tierInfo.division < 4) {
    const nextDivision = tierInfo.division + 1;
    const goalPercentile = lowerPercentBound - (rankWidth * tierInfo.division) / 4;
    const romans = ['I', 'II', 'III', 'IV'];
    return {
      name: `${tierInfo.rank.name} Division ${romans[nextDivision - 1]}`,
      rank: Math.floor(goalPercentile * total) + 1,
    };
  }

  const nextRank = TRACKMANIA_RANKS[rankIndex - 1];
  if (!nextRank) {
    throw new Error(`No higher rank exists above ${tierInfo.rank.name}.`);
  }

  return {
    name: nextRank.name,
    rank: Math.floor(upperPercentBound * total) + 1,
  };
}

/**
 * Calculates rating threshold bands for all ranks to render background zones in charts.
 */
export async function getRankThresholdBands(): Promise<RankThresholdBand[]> {
  const now = Date.now();
  if (cachedRankBands && now - cachedRankBands.timestamp < CACHE_TTL_MS) {
    return cachedRankBands.bands;
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(playerRatingStateTable)
    .where(
      and(
        eq(playerRatingStateTable.mode, 'qualifying'),
        isNotNull(playerRatingStateTable.lastProcessedCupId),
        gte(playerRatingStateTable.matchCount, MIN_RANKED_COTDS),
      )
    );
  const totalPlayers = countResult?.count ?? 0;
  if (totalPlayers === 0) {
    cachedRankBands = { timestamp: now, bands: [] };
    return [];
  }

  const targetIndices: number[] = [0];
  let prevIdx = -1;
  for (let i = 0; i < TRACKMANIA_RANKS.length; i++) {
    const targetIdx = i === TRACKMANIA_RANKS.length - 1
      ? totalPlayers - 1
      : Math.min(
        totalPlayers - 1,
        Math.max(prevIdx + 1, Math.floor(totalPlayers * TRACKMANIA_RANKS[i].topPercent))
      );
    targetIndices.push(targetIdx);
    prevIdx = targetIdx;
  }

  const rankedPlayers = db.$with('ranked_players').as(
    db.select({
      rankIndex: sql<number>`row_number() over (
        order by ${playerRatingStateTable.rating} desc,
          ${playerRatingStateTable.accountId} asc
      ) - 1`.as('rank_index'),
      rating: playerRatingStateTable.rating,
    })
      .from(playerRatingStateTable)
      .where(
        and(
          eq(playerRatingStateTable.mode, 'qualifying'),
          isNotNull(playerRatingStateTable.lastProcessedCupId),
          gte(playerRatingStateTable.matchCount, MIN_RANKED_COTDS),
        )
      )
  );
  const cutoffRows = await db.with(rankedPlayers)
    .select({ rankIndex: rankedPlayers.rankIndex, rating: rankedPlayers.rating })
    .from(rankedPlayers)
    .where(inArray(rankedPlayers.rankIndex, targetIndices));
  const ratingByIndex = new Map(cutoffRows.map(row => [row.rankIndex, row.rating]));
  const firstRating = ratingByIndex.get(0);
  if (firstRating === undefined) {
    throw new Error('Could not load the top active player rating for chart thresholds.');
  }

  const bands: RankThresholdBand[] = [];
  let prevRating = firstRating + 50;
  for (let i = 0; i < TRACKMANIA_RANKS.length; i++) {
    const rank = TRACKMANIA_RANKS[i];
    const targetIdx = targetIndices[i + 1];
    const cutoffRating = ratingByIndex.get(targetIdx);
    if (cutoffRating === undefined) {
      throw new Error(`Could not load rank threshold rating at leaderboard position ${targetIdx}.`);
    }

    bands.push({
      rank,
      maxRating: prevRating,
      minRating: cutoffRating,
    });
    prevRating = cutoffRating;
  }

  cachedRankBands = { timestamp: now, bands };
  return bands;
}
