import { existsSync, readFileSync } from 'node:fs';
import { advanceGlickoRd, updateGlicko2, type GlickoOpponent } from './glicko2Math';

/**
 * These values calibrate one COTD qualifying leaderboard as one Glicko-2
 * rating period. They are intentionally centralized so replay reports can
 * tune the distribution without introducing rating caps.
 */
export interface QualifyingRatingConfig {
  initialRating: number;
  initialRd: number;
  initialVolatility: number;
  representativeCount: number;
  tournamentInformation: number;
  ratingEvidenceMultiplier: number;
  rankPerformanceSoftness: number;
  provisionalMinimum: number;
  provisionalCups: number;
  tau: number;
  inactiveDaysPerPeriod: number;
  leaderboardConfidenceMultiplier: number;
}

const DEFAULT_QUALIFYING_RATING_CONFIG: QualifyingRatingConfig = {
  initialRating: 1400,
  initialRd: 250,
  initialVolatility: 0.1,
  representativeCount: 32,
  tournamentInformation: .55,
  ratingEvidenceMultiplier: 1.05,
  // Lower softness makes placement behave more like a decisive win/loss.
  // This is a model calibration value, not a rating cap.
  rankPerformanceSoftness: 0.006,
  provisionalMinimum: 0.7,
  provisionalCups: 0,
  tau: 0.5,
  inactiveDaysPerPeriod: 7,
  leaderboardConfidenceMultiplier: 0.5,
};

interface RatingCalibrationArtifact {
  schemaVersion: number;
  initialRating: number;
  initialRd: number;
  initialVolatility: number;
  rankPerformanceSoftness: number;
  tournamentInformation: number;
  ratingEvidenceMultiplier: number;
  provisionalMinimum: number;
  provisionalCups: number;
  tau: number;
}

function loadRatingCalibration(): Partial<QualifyingRatingConfig> {
  const artifactUrl = new URL('../../rating-calibration.json', import.meta.url);
  if (!existsSync(artifactUrl)) {
    return {
      rankPerformanceSoftness: DEFAULT_QUALIFYING_RATING_CONFIG.rankPerformanceSoftness,
      tournamentInformation: DEFAULT_QUALIFYING_RATING_CONFIG.tournamentInformation,
    };
  }

  const artifact = JSON.parse(readFileSync(artifactUrl, 'utf8')) as RatingCalibrationArtifact;
  if (
    artifact.schemaVersion !== 1
    || !Number.isFinite(artifact.initialRating)
    || !Number.isFinite(artifact.initialRd)
    || artifact.initialRd <= 0
    || !Number.isFinite(artifact.initialVolatility)
    || artifact.initialVolatility <= 0
    || !Number.isFinite(artifact.rankPerformanceSoftness)
    || artifact.rankPerformanceSoftness <= 0
    || !Number.isFinite(artifact.tournamentInformation)
    || artifact.tournamentInformation <= 0
    || !Number.isFinite(artifact.ratingEvidenceMultiplier)
    || artifact.ratingEvidenceMultiplier <= 0
    || !Number.isFinite(artifact.provisionalMinimum)
    || artifact.provisionalMinimum < 0
    || artifact.provisionalMinimum > 1
    || !Number.isFinite(artifact.provisionalCups)
    || artifact.provisionalCups <= 0
    || !Number.isFinite(artifact.tau)
    || artifact.tau <= 0
  ) {
    throw new Error('rating-calibration.json has an unsupported or invalid model configuration.');
  }

  return {
    initialRating: artifact.initialRating,
    initialRd: artifact.initialRd,
    initialVolatility: artifact.initialVolatility,
    rankPerformanceSoftness: artifact.rankPerformanceSoftness,
    tournamentInformation: artifact.tournamentInformation,
    ratingEvidenceMultiplier: artifact.ratingEvidenceMultiplier,
    provisionalMinimum: artifact.provisionalMinimum,
    provisionalCups: artifact.provisionalCups,
    tau: artifact.tau,
  };
}

export const QUALIFYING_RATING_CONFIG: QualifyingRatingConfig = {
  ...DEFAULT_QUALIFYING_RATING_CONFIG,
  ...loadRatingCalibration(),
};

export interface GlickoState {
  rating: number;
  rd: number;
  vol: number;
  matchCount?: number;
}

export interface ParticipantRank {
  player: string;
  rank: number;
  rating: number;
  rd: number;
}

export interface QualifyingResultSignal {
  rating: number;
  matchCount: number;
  rank: number;
  ratingSeedRank: number;
  fieldSize: number;
}

export interface AbandonedRunFilterConfig {
  minimumMatchCount: number;
  minimumRating: number;
  seedRankFraction: number;
  minimumSeedRank: number;
  strongestSeedAbandonedRankPercentile: number;
  weakestEligibleSeedAbandonedRankPercentile: number;
}

export const DEFAULT_ABANDONED_RUN_FILTER_CONFIG: AbandonedRunFilterConfig = {
  minimumMatchCount: 50,
  minimumRating: 1500,
  seedRankFraction: 0.1,
  minimumSeedRank: 20,
  strongestSeedAbandonedRankPercentile: 22,
  weakestEligibleSeedAbandonedRankPercentile: 85,
};

export function getRatingSeedRanks(ratings: number[]): number[] {
  const sorted = ratings
    .map((rating, index) => ({ rating, index }))
    .sort((left, right) => right.rating - left.rating || left.index - right.index);
  const ranks = Array<number>(ratings.length);

  sorted.forEach((entry, index) => {
    ranks[entry.index] = index > 0 && entry.rating === sorted[index - 1].rating
      ? ranks[sorted[index - 1].index]
      : index + 1;
  });

  return ranks;
}

function qualifiesForAbandonedRankPercentile(
  result: QualifyingResultSignal,
  strongestSeedRankPercentile: number,
  config: AbandonedRunFilterConfig = DEFAULT_ABANDONED_RUN_FILTER_CONFIG,
): boolean {
  const seedRankLimit = Math.max(
    config.minimumSeedRank,
    Math.floor(result.fieldSize * config.seedRankFraction),
  );
  if (
    result.matchCount < config.minimumMatchCount
    || result.rating < config.minimumRating
    || result.ratingSeedRank > seedRankLimit
    || result.fieldSize <= 0
  ) {
    return false;
  }

  const eloStrength = seedRankLimit <= 1
    ? 1
    : 1 - Math.min(1, (result.ratingSeedRank - 1) / (seedRankLimit - 1));
  const abandonedRankPercentile = config.weakestEligibleSeedAbandonedRankPercentile
    - eloStrength * (
      config.weakestEligibleSeedAbandonedRankPercentile
      - strongestSeedRankPercentile
    );
  const resultRankPercentile = result.rank / result.fieldSize * 100;

  return resultRankPercentile >= abandonedRankPercentile;
}

/** Flags a strong, experienced player's unusually poor placement despite a near-leading time. */
export function isLikelyAbandonedQualifyingRun(
  result: QualifyingResultSignal,
  config: AbandonedRunFilterConfig = DEFAULT_ABANDONED_RUN_FILTER_CONFIG,
): boolean {
  return qualifiesForAbandonedRankPercentile(
    result,
    config.strongestSeedAbandonedRankPercentile,
    config,
  );
}

/** Applies inactivity uncertainty before a player's next qualifying result. */
export function prepareQualifyingState(
  state: GlickoState,
  lastRatedAt: Date | null | undefined,
  ratedAt: Date,
): GlickoState {
  if (!lastRatedAt || ratedAt <= lastRatedAt) return state;

  const elapsedDays = (ratedAt.getTime() - lastRatedAt.getTime()) / (24 * 60 * 60 * 1000);
  const elapsedPeriods = Math.max(0, elapsedDays / QUALIFYING_RATING_CONFIG.inactiveDaysPerPeriod);
    return {
      ...state,
      rd: advanceGlickoRd(state.rd, state.vol, elapsedPeriods),
    };
}

function placementScore(
  playerRank: number,
  opponentRank: number,
  fieldSize: number,
  config: QualifyingRatingConfig,
): number {
  if (playerRank === opponentRank) return 0.5;

  const percentileGap = Math.abs(opponentRank - playerRank) / Math.max(1, fieldSize - 1);
  const softness = config.rankPerformanceSoftness;
  const magnitude = 0.5 * (1 - Math.exp(-percentileGap / softness));
  return opponentRank > playerRank ? 0.5 + magnitude : 0.5 - magnitude;
}

function selectRepresentatives(
  playerIndex: number,
  participants: ParticipantRank[],
  config: QualifyingRatingConfig,
): Array<{ participant: ParticipantRank; representedCount: number }> {
  const eligible = participants.filter((_, index) => index !== playerIndex);
  const count = Math.min(config.representativeCount, eligible.length);
  if (count === 0) return [];

  const representatives: Array<{ participant: ParticipantRank; representedCount: number }> = [];
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor(bucket * eligible.length / count);
    const end = Math.floor((bucket + 1) * eligible.length / count);
    const bucketSize = Math.max(1, end - start);
    const middle = start + Math.floor((bucketSize - 1) / 2);
    representatives.push({ participant: eligible[middle], representedCount: bucketSize });
  }
  return representatives;
}

/**
 * Multi-player Tournament Glicko-2 update for Trackmania COTD.
 * Evaluates performance against the competitive distribution of the field.
 */
export function applyQualifyingCupResult(
  state: GlickoState,
  player: string,
  playerRank: number,
  opponents: ParticipantRank[],
  playerIndex?: number,
  config: QualifyingRatingConfig = QUALIFYING_RATING_CONFIG,
): GlickoState {
  const total = opponents.length;
  if (total <= 1) return state;

  const currentIndex = playerIndex ?? opponents.findIndex(opponent => opponent.player === player);
  if (currentIndex < 0) return state;

    const representatives = selectRepresentatives(currentIndex, opponents, config);
  const fieldOpponents: GlickoOpponent[] = representatives.map(({ participant, representedCount }) => ({
    rating: participant.rating,
    rd: participant.rd,
    score: placementScore(playerRank, participant.rank, total, config),
    weight: config.tournamentInformation * representedCount / (total - 1),
    ratingWeight: config.tournamentInformation
      * config.ratingEvidenceMultiplier
      * representedCount / (total - 1),
  }));

  if (fieldOpponents.length === 0) return state;

  // Provisional players participate with less effective tournament information;
  // established players use the full calibrated period. The same weight is
  // used throughout Glicko-2, preserving the rating/RD/volatility coupling.
  const experienceFactor = Math.min(
    1,
    config.provisionalMinimum
      + (1 - config.provisionalMinimum)
        * (state.matchCount ?? 0) / config.provisionalCups,
  );
  const matches = fieldOpponents.map(opponent => ({
    ...opponent,
    weight: (opponent.weight ?? 1) * experienceFactor,
  }));

  return updateGlicko2(state.rating, state.rd, state.vol, matches, config.tau);
}

