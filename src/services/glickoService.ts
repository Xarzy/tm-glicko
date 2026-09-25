import { updateGlicko2, type GlickoOpponent } from './glicko2Math';

export interface GlickoState { rating: number; rd: number; vol: number }

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
  playerRank: number,
  opponents: ParticipantRank[]
): GlickoState {
  const total = opponents.length;
  if (total <= 1) return state;

  // Normalized percentile: rank 1 is ~0.999, last place is ~0.001
  const rawPercentile = (total - playerRank) / (total - 1);
  const percentile = Math.max(0.001, Math.min(0.999, rawPercentile));

  // Compute field distribution
  let sumRating = 0;
  let sumRd = 0;
  for (const o of opponents) {
    sumRating += o.rating;
    sumRd += o.rd;
  }
  const avgRating = sumRating / total;
  const avgRd = Math.max(50, sumRd / total);

  // Tournament equivalent opponents:
  // Evaluates the result across standard deviation tiers of the tournament field.
  // This allows top players (who beat 99.9% of the field) to reliably reach 2800-3200,
  // while median players stay ~1500 and lower-tier players stay ~800-1100 without collapsing.
  const SCALE = 173.7178;
  const spread = [-2.2, -1.6, -1.1, -0.6, -0.2, 0.2, 0.6, 1.1, 1.6, 2.2];

  const matches: GlickoOpponent[] = spread.map(sigmaOffset => {
    const oppRating = avgRating + sigmaOffset * SCALE;
    // Approximated CDF percentile for this tier in a standard field
    const tierPercentile = 1 / (1 + Math.exp(-sigmaOffset * 1.6));
    const score = percentile > tierPercentile ? 1.0 : percentile < tierPercentile ? 0.0 : 0.5;

    return {
      rating: oppRating,
      rd: avgRd,
      score,
    };
  });

  return updateGlicko2(state.rating, state.rd, state.vol, matches, 0.5);
}
