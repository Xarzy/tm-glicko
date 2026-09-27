export interface GlickoOpponent {
  rating: number;
  rd: number;
  score: number; // continuous [0,1] here (percentile), but 0/0.5/1 works too
  weight?: number;
  ratingWeight?: number;
}

const SCALE = 173.7178;
const EPSILON = 0.000001;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

export function updateGlicko2(
  rating: number,
  rd: number,
  vol: number,
  opponents: GlickoOpponent[],
  tau = 0.5
): { rating: number; rd: number; vol: number } {
  if (opponents.length === 0) {
    // No games this period — per the algorithm, RD grows toward uncertainty, nothing else moves.
    const phi = rd / SCALE;
    const phiStar = Math.sqrt(phi * phi + vol * vol);
    return { rating, rd: phiStar * SCALE, vol };
  }

  const mu = (rating - 1500) / SCALE;
  const phi = rd / SCALE;

  let vInv = 0;
  let deltaSum = 0;
  for (const opp of opponents) {
    const muJ = (opp.rating - 1500) / SCALE;
    const phiJ = opp.rd / SCALE;
    const gPhiJ = g(phiJ);
    const e = expectedScore(mu, muJ, phiJ);
    const weight = opp.weight ?? 1;
    vInv += weight * gPhiJ * gPhiJ * e * (1 - e);
    const ratingWeight = opp.ratingWeight ?? weight;
    deltaSum += ratingWeight * gPhiJ * (opp.score - e);
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
    if (fC * fB < 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  let newVol = Number.isFinite(A) ? Math.exp(A / 2) : vol;
  // Volatility safety clamp (standard Glicko-2 constraint)
  newVol = Math.max(0.01, Math.min(0.15, newVol));

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  const newRating = Math.max(100, newMu * SCALE + 1500);
  const newRd = Math.max(30, Math.min(350, newPhi * SCALE));

  return { rating: newRating, rd: newRd, vol: newVol };
}