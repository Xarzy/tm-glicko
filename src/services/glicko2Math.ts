export interface GlickoOpponent {
  rating: number;
  rd: number;
  score: number;
  weight?: number;
  ratingWeight?: number;
}

export const GLICKO_SCALE = 173.7178;
export const MIN_RD = 30;
export const MAX_RD = 350;
export const MIN_VOLATILITY = 0.01;
export const MAX_VOLATILITY = 0.15;
const EPSILON = 0.000001;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Glicko-2 ${name} must be finite.`);
  }
}

/**
 * Propagates uncertainty through elapsed Glicko rating periods without moving
 * the rating. Call this before a returning player receives their next result.
 */
export function advanceGlickoRd(
  rd: number,
  vol: number,
  elapsedPeriods = 1,
): number {
  assertFinite('RD', rd);
  assertFinite('volatility', vol);
  assertFinite('elapsed periods', elapsedPeriods);
  if (vol <= 0) throw new Error('Glicko-2 volatility must be greater than zero.');

  const periods = Math.max(0, elapsedPeriods);
  if (periods === 0) return clamp(rd, MIN_RD, MAX_RD);
  const phi = clamp(rd, MIN_RD, MAX_RD) / GLICKO_SCALE;
  const safeVol = clamp(vol, MIN_VOLATILITY, MAX_VOLATILITY);
  const phiStar = Math.sqrt(phi * phi + periods * safeVol * safeVol);
  return clamp(phiStar * GLICKO_SCALE, MIN_RD, MAX_RD);
}

export function updateGlicko2(
  rating: number,
  rd: number,
  vol: number,
  opponents: GlickoOpponent[],
  tau = 0.5
): { rating: number; rd: number; vol: number } {
  assertFinite('rating', rating);
  assertFinite('RD', rd);
  assertFinite('volatility', vol);
  assertFinite('tau', tau);
  if (vol <= 0) throw new Error('Glicko-2 volatility must be greater than zero.');
  if (tau <= 0) throw new Error('Glicko-2 tau must be greater than zero.');

  if (opponents.length === 0) {
    return { rating, rd: advanceGlickoRd(rd, vol), vol };
  }

  const mu = (rating - 1500) / GLICKO_SCALE;
  const phi = clamp(rd, MIN_RD, MAX_RD) / GLICKO_SCALE;

  let vInv = 0;
  let deltaSum = 0;
  for (const opp of opponents) {
    assertFinite('opponent rating', opp.rating);
    assertFinite('opponent RD', opp.rd);
    assertFinite('opponent score', opp.score);
    const weight = opp.weight ?? 1;
    const ratingWeight = opp.ratingWeight ?? weight;
    assertFinite('opponent weight', weight);
    assertFinite('opponent rating weight', ratingWeight);
    if (weight < 0 || ratingWeight < 0 || opp.score < 0 || opp.score > 1) {
      throw new Error('Glicko-2 opponent weights must be non-negative and scores must be in [0, 1].');
    }
    if (weight === 0) continue;

    const muJ = (opp.rating - 1500) / GLICKO_SCALE;
    const phiJ = clamp(opp.rd, MIN_RD, MAX_RD) / GLICKO_SCALE;
    const gPhiJ = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    vInv += weight * gPhiJ * gPhiJ * e * (1 - e);
    deltaSum += ratingWeight * gPhiJ * (opp.score - e);
  }
  if (vInv <= 0 || !Number.isFinite(vInv)) {
    return { rating, rd: advanceGlickoRd(rd, vol), vol };
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5 — iterative volatility solve (Illinois algorithm, per Glickman's paper)
  const a = Math.log(vol * vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < 100) k++;
    B = a - k * tau;
  }

  let fA = f(A), fB = f(B);
  let iter = 0;
  while (Math.abs(B - A) > EPSILON && iter < 100) {
    iter++;
    const denom = fB - fA;
    if (Math.abs(denom) < 1e-12) break;
    const C = A + ((A - B) * fA) / denom;
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  let newVol = Number.isFinite(A) ? Math.exp(A / 2) : vol;
  newVol = clamp(newVol, MIN_VOLATILITY, MAX_VOLATILITY);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  const newRating = Math.max(100, newMu * GLICKO_SCALE + 1500);
  const newRd = clamp(newPhi * GLICKO_SCALE, MIN_RD, MAX_RD);

  return { rating: newRating, rd: newRd, vol: newVol };
}