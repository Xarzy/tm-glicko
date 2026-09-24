import { Glicko2 } from 'glicko2.ts';
import type { CotdCup } from '../types/cotd';

const ranking = new Glicko2({ rating: 1500, rd: 350, vol: 0.06, tau: 0.5 });

// Simplification: one virtual match per qualifying result, against a fixed
// reference opponent, instead of real pairwise matches against ~2000 people.
// Tune these two constants once you see real rating spread.
const FIELD_RATING = 1500;
const FIELD_RD = 60;

function percentileScore(cup: CotdCup): number {
  if (cup.totalplayers <= 1) return 0.5;
  return (cup.totalplayers - cup.qualificationrank) / (cup.totalplayers - 1);
}

export interface GlickoState {
  rating: number;
  rd: number;
  vol: number;
}

export function applyQualifyingResults(
  state: GlickoState,
  cupsChronological: CotdCup[] // must be oldest → newest
): GlickoState {
  let current = state;

  for (const cup of cupsChronological) {
    const player = ranking.makePlayer(current.rating, current.rd, current.vol);
    const field = ranking.makePlayer(FIELD_RATING, FIELD_RD);
    ranking.updateRatings([[player, field, percentileScore(cup)]]);

    current = { rating: player.getRating(), rd: player.getRd(), vol: player.getVol() };
  }

  return current;
}

export function applySingleQualifyingResult(state: GlickoState, percentileScore: number): GlickoState {
  const player = ranking.makePlayer(state.rating, state.rd, state.vol);
  const field = ranking.makePlayer(FIELD_RATING, FIELD_RD);
  ranking.updateRatings([[player, field, percentileScore]]);
  return { rating: player.getRating(), rd: player.getRd(), vol: player.getVol() };
}