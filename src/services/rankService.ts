import { db } from '../db';
import { playerRatingStateTable } from '../db/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

export interface RankDefinition {
  code: string;       // e.g. 'ssl', 'gc3', 'd1'
  name: string;       // e.g. 'Supersonic Legend', 'Grand Champion III'
  shortName: string;  // e.g. 'SSL', 'GC3'
  tierColor: number;  // Hex color for discord embed
  svgColor: string;   // Hex color for SVG zone
  topPercent: number; // Cumulative threshold from top (0 to 1). Lower = higher rank
  iconFile: string;   // e.g. 'ssl.png', 'gc3.png'
}

/**
 * Standard Rocket League Rank Distribution (Loyal to RL Tracker / Psyonix official distributions):
 * Cumulative top percentiles:
 * SSL:       Top 0.05%
 * GC3:       Top 0.20%
 * GC2:       Top 0.50%
 * GC1:       Top 1.20%
 * C3:        Top 2.50%
 * C2:        Top 4.50%
 * C1:        Top 7.50%
 * D3:        Top 12.0%
 * D2:        Top 18.0%
 * D1:        Top 26.0%
 * P3:        Top 36.0%
 * P2:        Top 47.0%
 * P1:        Top 58.0%
 * G3:        Top 68.0%
 * G2:        Top 77.0%
 * G1:        Top 84.0%
 * S3:        Top 90.0%
 * S2:        Top 94.0%
 * S1:        Top 97.0%
 * B3:        Top 98.5%
 * B2:        Top 99.5%
 * B1:        Top 100.0%
 */
export const RL_RANKS: RankDefinition[] = [
  { code: 'ssl', name: 'Supersonic Legend', shortName: 'SSL', tierColor: 0xffffff, svgColor: '#e0f7fa', topPercent: 0.0005, iconFile: 'ssl.png' },
  { code: 'gc3', name: 'Grand Champion III', shortName: 'GC3', tierColor: 0xda291c, svgColor: '#b71c1c', topPercent: 0.0020, iconFile: 'gc3.png' },
  { code: 'gc2', name: 'Grand Champion II', shortName: 'GC2', tierColor: 0xda291c, svgColor: '#c62828', topPercent: 0.0050, iconFile: 'gc2.png' },
  { code: 'gc1', name: 'Grand Champion I', shortName: 'GC1', tierColor: 0xda291c, svgColor: '#d32f2f', topPercent: 0.0120, iconFile: 'gc1.png' },
  { code: 'c3', name: 'Champion III', shortName: 'C3', tierColor: 0x800080, svgColor: '#6a1b9a', topPercent: 0.0250, iconFile: 'c3.png' },
  { code: 'c2', name: 'Champion II', shortName: 'C2', tierColor: 0x800080, svgColor: '#7b1fa2', topPercent: 0.0450, iconFile: 'c2.png' },
  { code: 'c1', name: 'Champion I', shortName: 'C1', tierColor: 0x800080, svgColor: '#8e24aa', topPercent: 0.0750, iconFile: 'c1.png' },
  { code: 'd3', name: 'Diamond III', shortName: 'D3', tierColor: 0x0099ff, svgColor: '#0277bd', topPercent: 0.1200, iconFile: 'd3.png' },
  { code: 'd2', name: 'Diamond II', shortName: 'D2', tierColor: 0x0099ff, svgColor: '#0288d1', topPercent: 0.1800, iconFile: 'd2.png' },
  { code: 'd1', name: 'Diamond I', shortName: 'D1', tierColor: 0x0099ff, svgColor: '#039be5', topPercent: 0.2600, iconFile: 'd1.png' },
  { code: 'p3', name: 'Platinum III', shortName: 'P3', tierColor: 0x00ffff, svgColor: '#00838f', topPercent: 0.3600, iconFile: 'p3.png' },
  { code: 'p2', name: 'Platinum II', shortName: 'P2', tierColor: 0x00ffff, svgColor: '#0097a7', topPercent: 0.4700, iconFile: 'p2.png' },
  { code: 'p1', name: 'Platinum I', shortName: 'P1', tierColor: 0x00ffff, svgColor: '#00acc1', topPercent: 0.5800, iconFile: 'p1.png' },
  { code: 'g3', name: 'Gold III', shortName: 'G3', tierColor: 0xffcc00, svgColor: '#f9a825', topPercent: 0.6800, iconFile: 'g3.png' },
  { code: 'g2', name: 'Gold II', shortName: 'G2', tierColor: 0xffcc00, svgColor: '#fbc02d', topPercent: 0.7700, iconFile: 'g2.png' },
  { code: 'g1', name: 'Gold I', shortName: 'G1', tierColor: 0xffcc00, svgColor: '#fdd835', topPercent: 0.8400, iconFile: 'g1.png' },
  { code: 's3', name: 'Silver III', shortName: 'S3', tierColor: 0xcccccc, svgColor: '#757575', topPercent: 0.9000, iconFile: 's3.png' },
  { code: 's2', name: 'Silver II', shortName: 'S2', tierColor: 0xcccccc, svgColor: '#9e9e9e', topPercent: 0.9400, iconFile: 's2.png' },
  { code: 's1', name: 'Silver I', shortName: 'S1', tierColor: 0xcccccc, svgColor: '#bdbdbd', topPercent: 0.9700, iconFile: 's1.png' },
  { code: 'b3', name: 'Bronze III', shortName: 'B3', tierColor: 0xcd7f32, svgColor: '#5d4037', topPercent: 0.9850, iconFile: 'b3.png' },
  { code: 'b2', name: 'Bronze II', shortName: 'B2', tierColor: 0xcd7f32, svgColor: '#6d4c41', topPercent: 0.9950, iconFile: 'b2.png' },
  { code: 'b1', name: 'Bronze I', shortName: 'B1', tierColor: 0xcd7f32, svgColor: '#795548', topPercent: 1.0000, iconFile: 'b1.png' },
];

export interface PlayerRankTierInfo {
  rank: RankDefinition;
  division: number; // 1 to 4 (1 = lowest, 4 = highest)
  divisionRoman: string; // 'I', 'II', 'III', 'IV'
  topPercentage: number; // e.g. 3.42 (%)
  fullName: string; // e.g. "Champion I Division III" or "Supersonic Legend"
  iconPath: string; // Path to image file in images/
}

export interface RankThresholdBand {
  rank: RankDefinition;
  minRating: number;
  maxRating: number;
}

// In-memory cache of rating cutoff thresholds to avoid heavy database recalculations on every slash command
let cachedCutoffs: { timestamp: number; totalPlayers: number; ratings: number[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getActiveRatings(): Promise<number[]> {
  const now = Date.now();
  if (cachedCutoffs && now - cachedCutoffs.timestamp < CACHE_TTL_MS) {
    return cachedCutoffs.ratings;
  }

  const rows = await db
    .select({ rating: playerRatingStateTable.rating })
    .from(playerRatingStateTable)
    .where(
      and(
        eq(playerRatingStateTable.mode, 'qualifying'),
        isNotNull(playerRatingStateTable.lastProcessedCupId)
      )
    )
    .orderBy(sql`${playerRatingStateTable.rating} DESC`);

  const ratings = rows.map(r => r.rating);
  cachedCutoffs = {
    timestamp: now,
    totalPlayers: ratings.length,
    ratings,
  };
  return ratings;
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
  const ratings = await getActiveRatings();
  const total = totalPlayersCount ?? ratings.length;

  if (total === 0) {
    const unranked = RL_RANKS[RL_RANKS.length - 1];
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
  if (playerRankIndex !== undefined) {
    percentile = (playerRankIndex - 1) / total;
  } else {
    // Binary search / find rank by rating
    let rankPos = 1;
    for (const r of ratings) {
      if (r > playerRating) rankPos++;
      else break;
    }
    percentile = (rankPos - 1) / total;
  }

  percentile = Math.max(0, Math.min(0.9999, percentile));
  const topPercentage = +(percentile * 100).toFixed(2);

  // 2. Identify the Rank
  let currentRank = RL_RANKS[RL_RANKS.length - 1];
  let lowerPercentBound = 1.0;
  let upperPercentBound = 0.0;

  for (let i = 0; i < RL_RANKS.length; i++) {
    const r = RL_RANKS[i];
    if (percentile <= r.topPercent) {
      currentRank = r;
      upperPercentBound = i > 0 ? RL_RANKS[i - 1].topPercent : 0.0;
      lowerPercentBound = r.topPercent;
      break;
    }
  }

  // SSL does not have divisions in Rocket League
  if (currentRank.code === 'ssl') {
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

/**
 * Calculates rating threshold bands for all ranks to render background zones in charts.
 */
export async function getRankThresholdBands(): Promise<RankThresholdBand[]> {
  const ratings = await getActiveRatings();
  if (ratings.length === 0) return [];

  const bands: RankThresholdBand[] = [];
  let prevRating = ratings[0] + 50;
  let prevIdx = -1;

  for (let i = 0; i < RL_RANKS.length; i++) {
    const r = RL_RANKS[i];
    const rawIdx = Math.floor(ratings.length * r.topPercent);
    const targetIdx =
      i === RL_RANKS.length - 1
        ? ratings.length - 1
        : Math.min(ratings.length - 1, Math.max(prevIdx + 1, rawIdx));
    const cutoffRating = ratings[targetIdx];

    bands.push({
      rank: r,
      maxRating: prevRating,
      minRating: cutoffRating,
    });
    prevRating = cutoffRating;
    prevIdx = targetIdx;
  }

  return bands;
}
