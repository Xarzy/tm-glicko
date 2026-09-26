import { updateGlicko2, type GlickoOpponent } from './glicko2Math';

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
): GlickoState {
  const total = opponents.length;
  if (total <= 1) return state;

  const currentIndex = playerIndex ?? opponents.findIndex(opponent => opponent.player === player);
  if (currentIndex < 0) return state;

  // Keep the calculation bounded for large cups while sampling the full rank
  // distribution, so strong, middle, and weak opponents all remain represented.
  const eligibleCount = total - 1;
  const sampleCount = Math.min(64, eligibleCount);
  const PLACEMENT_SMOOTHING = 40;
  const fieldOpponents: GlickoOpponent[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const compressedIndex = sampleCount === 1
      ? 0
      : Math.round(sampleIndex * (eligibleCount - 1) / (sampleCount - 1));
    const opponentIndex = compressedIndex >= currentIndex ? compressedIndex + 1 : compressedIndex;
    const opponent = opponents[opponentIndex];
    const placementGap = opponent.rank - playerRank;
    const comparableStrength = Math.abs(opponent.rating - state.rating) <= 300;
    const score = Math.abs(placementGap) <= 3 && comparableStrength
      ? 1 / (1 + Math.exp(-placementGap / PLACEMENT_SMOOTHING))
      : placementGap > 0 ? 1 : 0;
    fieldOpponents.push({
      rating: opponent.rating,
      rd: opponent.rd,
      score,
    });
  }

  if (fieldOpponents.length === 0) return state;

  // A tournament is one rating period, not one full-strength match per entrant.
  // Normalize the field so adding more participants does not multiply rating
  // movement or collapse RD toward its floor.
  const UNCERTAINTY_INFLUENCE = 0.9;
  const RATING_INFLUENCE = 7;
  const uncertaintyWeight = UNCERTAINTY_INFLUENCE / fieldOpponents.length;
  // New players need sustained results before a small sample can place them
  // at the top. Their RD still reflects uncertainty, but rating movement is
  // ramped up over the first 500 cups.
  const experienceFactor = Math.min(1, 0.25 + (state.matchCount ?? 0) / 500);
  const ratingWeight = RATING_INFLUENCE * experienceFactor / fieldOpponents.length;
  const matches: GlickoOpponent[] = fieldOpponents.map(opponent => ({
    ...opponent,
    weight: uncertaintyWeight,
    ratingWeight,
  }));

  const tau = .7;

  return updateGlicko2(state.rating, state.rd, state.vol, matches, tau);
}

